import { afterRenderEffect, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { buildFilm, FilmPrevious } from '../../core/film-build';
import { FilmModel } from '../../core/film-model';
import { nextAskAt } from '../../core/film-progress';
import { FilmChoice, FilmProgress, GameReview } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { MatchTimelineService } from '../../services/match-timeline.service';
import { MotionService } from '../../services/motion.service';
import { TeamDataService } from '../../services/team-data.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { FILM_CHAPTER_KEY } from '../../shared/film/film-poster.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { FilmCardComponent } from './chapters/film-card.component';
import { FilmOneThingComponent } from './chapters/film-one-thing.component';
import { FilmSeatComponent } from './chapters/film-seat.component';
import { FilmTitleComponent } from './chapters/film-title.component';

/** The deck becomes a vertical scroll-snap run below this width; above it one chapter fills the stage. */
const NARROW_QUERY = '(max-width: 48rem)';

/**
 * The film room (9 Sep 2026): one review walked as chapters the team calls
 * before they are revealed, at /film/:matchId. The page owns what changes
 * while the film plays: which chapter is up, the keyboard, the dot rail, the
 * timeline read, and every write to a person's progress. The chapters own
 * their own reveals and the team's writes (the commitment, the notes, the
 * seat). Everything about the game itself comes from `buildFilm`.
 */
@Component({
  selector: 'app-film',
  imports: [RouterLink, TooltipDirective, FilmTitleComponent, FilmOneThingComponent, FilmSeatComponent, FilmCardComponent],
  templateUrl: './film.component.html'
})
export class FilmComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly motion = inject(MotionService);
  private readonly prefs = inject(UserPrefsService);
  private readonly timelines = inject(MatchTimelineService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly params = toSignal(this.route.paramMap);
  protected readonly matchId = computed(() => this.params()?.get('matchId') ?? '');
  protected readonly review = computed(() => this.data.reviewFor(this.matchId()));
  private readonly analysisById = computed(() => new Map((this.data.compAnalysis()?.games ?? []).map((g) => [g.matchId, g])));
  protected readonly game = computed(() => this.analysisById().get(this.matchId()));

  /** The other team's name, off the series the game belongs to or the scrim's replay; Riot games carry none. */
  protected readonly opponent = computed<string | undefined>(() => {
    const id = this.matchId();
    if (!id) return undefined;
    const seriesGame = this.data.seriesGames().find((g) => g.matchId === id);
    if (seriesGame) {
      const series = this.data.tournamentSeries().find((s) => s.id === seriesGame.seriesId);
      if (series?.opponent) return series.opponent;
    }
    return this.data.scrims().find((s) => s.id === id)?.opponent || undefined;
  });

  /** True while a timeline-tier review waits for its timeline; the title card needs none, the rest wait. */
  protected readonly timelinePending = computed(() => this.review()?.tier === 'timeline' && !this.timelines.known().has(this.matchId()));
  private readonly timeline = computed(() => (this.review()?.tier === 'timeline' ? (this.timelines.known().get(this.matchId()) ?? null) : null));
  protected readonly ledgerSummary = computed(() => this.timeline()?.facts?.ledgerSummary);

  /**
   * The newest other review from before this game, compared on the games'
   * dates: a review whose game the analysis no longer carries is not a
   * candidate. Only when this game itself has no date do both sides fall
   * back to when the review was written.
   */
  private readonly previous = computed<FilmPrevious | null>(() => {
    const r = this.review();
    if (!r) return null;
    const gameDate = (x: GameReview): number | undefined => this.analysisById().get(x.matchId)?.date;
    const dateOf = gameDate(r) !== undefined ? gameDate : (x: GameReview) => Date.parse(x.reviewedAt) || 0;
    const mine = dateOf(r)!;
    const before = this.data
      .gameReviews()
      .map((x) => ({ x, at: dateOf(x) }))
      .filter((c): c is { x: GameReview; at: number } => c.x.matchId !== r.matchId && c.at !== undefined && c.at < mine)
      .sort((a, b) => b.at - a.at)[0];
    return before ? { review: before.x, game: this.analysisById().get(before.x.matchId) } : null;
  });

  protected readonly model = computed<FilmModel | undefined>(() => {
    const r = this.review();
    return r ? buildFilm(r, this.game(), this.timeline(), this.previous(), this.opponent()) : undefined;
  });

  protected readonly chapter = signal(0);
  protected readonly narrow = signal(false);
  /** Bumped on Escape: the chapters fold whatever they have open. */
  protected readonly escapeTick = signal(0);
  protected readonly progress = computed<FilmProgress | undefined>(() => this.prefs.filmProgress(this.matchId()));
  protected readonly calls = computed(() => this.progress()?.calls);
  /** The reminder is on until the card is reached, then whatever the toggle last said. */
  protected readonly askAgain = computed(() => {
    const p = this.progress();
    return !p?.done || !!p.nextAskAt;
  });
  protected readonly current = computed(() => this.model()?.chapters[this.chapter()]);

  private readonly deck = viewChild<ElementRef<HTMLElement>>('deck');
  private wanted: string | null = null;
  private placed = false;
  /** The card's write happens once a visit, and only on walking onto it from the chapter before. */
  private cardReached = false;
  /** True while the chapter on stage is fading out; a move during it lands without a second fade. */
  private leaving = false;
  /** Counts every move, so a fade that finishes after a later move does not land its stale target. */
  private moves = 0;

  constructor() {
    this.wanted = this.route.snapshot.queryParamMap.get('c');
    this.watchWidth();

    // The timeline is read on demand, once, the way the review panel reads it.
    effect(() => {
      const r = this.review();
      if (r?.tier !== 'timeline' || this.timelines.known().has(r.matchId)) return;
      void this.timelines.load(r.matchId);
    });

    // ?c picks the chapter on arrival: an index, or a kind such as "seat".
    effect(() => {
      const m = this.model();
      if (!m || this.placed) return;
      this.placed = true;
      const i = this.resolveChapter(m, this.wanted);
      untracked(() => void this.go(i));
    });

    // The chapter goes back into the url and this browser, so a link and the poster both know where the film is.
    effect(() => {
      const m = this.model();
      const i = this.chapter();
      if (!m) return;
      const kind = m.chapters[i]?.kind;
      untracked(() => {
        if (kind && this.route.snapshot.queryParamMap.get('c') !== kind) {
          void this.router.navigate([], { relativeTo: this.route, queryParams: { c: kind }, queryParamsHandling: 'merge', replaceUrl: true });
        }
        try {
          localStorage.setItem(FILM_CHAPTER_KEY + m.matchId, String(i));
        } catch {
          /* private mode: the url still carries it */
        }
      });
    });

    // On a phone the deck scrolls and the dot rail follows the chapter in view.
    afterRenderEffect((onCleanup) => {
      const el = this.deck()?.nativeElement;
      const m = this.model();
      if (!el || !m || !this.narrow() || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const i = Number((e.target as HTMLElement).dataset['index']);
            if (Number.isFinite(i)) this.arrive(i);
          }
        },
        { root: el, threshold: 0.6 }
      );
      for (const child of Array.from(el.querySelectorAll<HTMLElement>('.film-chapter'))) io.observe(child);
      // The deck is fresh (first paint, or the timeline just landed): stand it on the chapter we are on before the observer reads the top.
      untracked(() => {
        const i = this.chapter();
        if (i > 0) el.querySelector<HTMLElement>(`.film-chapter[data-index="${i}"]`)?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
      onCleanup(() => io.disconnect());
    });
  }

  private watchWidth(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(NARROW_QUERY);
    this.narrow.set(media.matches);
    const onChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    media.addEventListener('change', onChange);
    this.destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
  }

  private resolveChapter(m: FilmModel, wanted: string | null): number {
    if (!wanted) return 0;
    const n = Number(wanted);
    if (Number.isInteger(n)) return Math.min(Math.max(n, 0), m.chapters.length - 1);
    const byKind = m.chapters.findIndex((c) => c.kind === wanted);
    return byKind >= 0 ? byKind : 0;
  }

  @HostListener('window:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (!this.model()) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'PageDown':
        event.preventDefault();
        void this.go(this.chapter() + 1);
        break;
      case 'ArrowUp':
      case 'PageUp':
        event.preventDefault();
        void this.go(this.chapter() - 1);
        break;
      case 'Escape':
        this.escapeTick.set(this.escapeTick() + 1);
        break;
    }
  }

  /**
   * Move to a chapter. On a wide screen the chapter on stage lifts and fades
   * first (180 ms, through `MotionService.play`, so with motion off it is
   * skipped) and the next one rises in through its own entrance; a second
   * move during that fade lands at once and the fade's own target is let go.
   * On a phone it means scrolling the deck to it.
   */
  protected async go(i: number): Promise<void> {
    const m = this.model();
    if (!m) return;
    const next = Math.min(Math.max(i, 0), m.chapters.length - 1);
    if (!this.narrow()) {
      const el = this.deck()?.nativeElement.querySelector<HTMLElement>('.film-chapter.is-current');
      if (el && next !== this.chapter() && !this.leaving && !this.motion.reduced()) {
        const move = ++this.moves;
        this.leaving = true;
        await this.motion.play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-0.6rem)' }], { duration: 180 * this.motion.tempo(el), easing: 'ease-in', fill: 'forwards' });
        this.leaving = false;
        // The chapter is off stage now; drop the fill so it comes back whole when walked to again.
        try {
          el.getAnimations().forEach((a) => a.cancel());
        } catch {
          /* no Web Animations: nothing to drop */
        }
        el.style.removeProperty('opacity');
        el.style.removeProperty('transform');
        // A later move landed during the fade: its chapter is the one on stage, not this stale target.
        if (move === this.moves) this.arrive(next);
        return;
      }
    }
    this.moves++;
    this.arrive(next);
    if (!this.narrow()) return;
    const el = this.deck()?.nativeElement.querySelector<HTMLElement>(`.film-chapter[data-index="${next}"]`);
    el?.scrollIntoView({ behavior: this.motion.reduced() ? 'auto' : 'smooth', block: 'start' });
  }

  /**
   * Land on a chapter, by a pill, a key, a dot or the deck scrolling. Walking
   * onto the card from the chapter before it is finishing the film; opening
   * a shared ?c=card link, or a jump from the dot rail, only shows it.
   */
  private arrive(next: number): void {
    const from = this.chapter();
    this.chapter.set(next);
    if (next === from + 1 && this.model()?.chapters[next]?.kind === 'card') this.reachCard();
  }

  // ---- Progress: every write to userPrefs.film goes through here ----------

  protected onAnswered(e: { key: string; choice: number }): void {
    const calls = { ...(this.progress()?.calls ?? {}), [e.key]: e.choice };
    void this.prefs.saveFilmProgress(this.matchId(), { calls });
  }

  /** A viewer's own pick on the commitment; an editor's goes to the team document from the chapter. */
  protected onChosen(choice: FilmChoice): void {
    void this.prefs.saveFilmProgress(this.matchId(), { choice });
  }

  /** The reminder toggle. Off clears the field: an undefined in the patch becomes a deleteField in the document. */
  protected onAskAgain(on: boolean): void {
    const p = this.progress();
    const done = p?.done ?? new Date().toISOString();
    const patch: Partial<FilmProgress> = on ? { nextAskAt: nextAskAt(done, 0), asked: 0 } : { nextAskAt: undefined };
    void this.prefs.saveFilmProgress(this.matchId(), patch);
  }

  /** Reaching the card is finishing the film: the time, the calls, and the first reminder if none was ever set. Once a visit. */
  private reachCard(): void {
    const id = this.matchId();
    if (!id || this.cardReached) return;
    this.cardReached = true;
    const p = this.progress();
    const done = p?.done ?? new Date().toISOString();
    const patch: Partial<FilmProgress> = { done, calls: p?.calls ?? {} };
    if (p?.asked === undefined) {
      patch.nextAskAt = nextAskAt(done, 0);
      patch.asked = 0;
    }
    void this.prefs.saveFilmProgress(id, patch);
  }
}
