import { afterRenderEffect, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { buildFilm, FilmPrevious } from '../../core/film-build';
import { FilmModel } from '../../core/film-model';
import { nextAskAt, reminderFor } from '../../core/film-progress';
import { easeOf, stageClasses, tempoOf } from '../../core/film-style';
import { FilmChoice, FilmProgress, GameReview } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { MatchTimelineService } from '../../services/match-timeline.service';
import { MotionService } from '../../services/motion.service';
import { ReplayRecordingService } from '../../services/replay-recording.service';
import { TeamDataService } from '../../services/team-data.service';
import { TourService } from '../../services/tour.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { FILM_CHAPTER_KEY } from '../../shared/film/film-poster.component';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { FilmBoardComponent } from './chapters/film-board.component';
import { FilmCardComponent } from './chapters/film-card.component';
import { FilmDraftComponent } from './chapters/film-draft.component';
import { FilmMapComponent } from './chapters/film-map.component';
import { FilmOneThingComponent } from './chapters/film-one-thing.component';
import { FilmSeatComponent } from './chapters/film-seat.component';
import { FilmStripComponent } from './chapters/film-strip.component';
import { FilmSeekRequest, FilmTapeComponent } from './chapters/film-tape.component';
import { FilmTitleComponent } from './chapters/film-title.component';

/** How far before a death the tape opens on Watch it, in game seconds. */
const WATCH_LEAD_SEC = 20;

/** The deck becomes a vertical scroll-snap run below this width; above it one chapter fills the stage. */
const NARROW_QUERY = '(max-width: 48rem)';

/**
 * A second Escape inside this window leaves the film (10 Sep 2026). The first one folds whatever a chapter has open
 * (a table, a note, the full-screen map) through `escapeTick`, and a chapter that did close something says so
 * through `escaped`, which disarms the window: only two presses in a row that found nothing to close go Back. Until
 * the second fix pass (10 Sep 2026) the page could not tell, and Escape, Escape out of full screen (the drawer, then
 * the full screen, the natural gesture) dropped the reader on Games and lost the tape's second and the seat view.
 */
const ESCAPE_TWICE_MS = 2000;

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
  imports: [TooltipDirective, FilmTitleComponent, FilmTapeComponent, FilmBoardComponent, FilmMapComponent, FilmStripComponent, FilmOneThingComponent, FilmDraftComponent, FilmSeatComponent, FilmCardComponent],
  templateUrl: './film.component.html'
})
export class FilmComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly motion = inject(MotionService);
  /** The film's own "Show me around" starts the film-room tour from the bar; the walk is `core/tours.ts`. */
  protected readonly tours = inject(TourService);
  private readonly prefs = inject(UserPrefsService);
  private readonly timelines = inject(MatchTimelineService);
  /** The local recorder's own document for this game, read on demand the way the timeline is. */
  private readonly recordings = inject(ReplayRecordingService);
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

  /** The recording, once the read has come back; `null` on the games — nearly all of them — that were never recorded. */
  private readonly recording = computed(() => this.recordings.recordingFor(this.matchId()) ?? null);
  /** True until that read has answered, either way. A game with no id to read is not waiting for anything. */
  protected readonly recordingPending = computed(() => !!this.matchId() && !this.recordings.known().has(this.matchId()));
  /**
   * What the chapters after the title card wait for. Both reads are folded
   * into one wait because both change the chapter list when they land — the
   * timeline turns the board into the tape and the map, a recording adds the
   * frames — and a `?c=` link is only resolved against a list that is final.
   * Without the recording in here, a `?c=strip` link landed on the title card
   * the way `?c=draft` used to before the timeline was folded in.
   */
  protected readonly pending = computed(() => this.timelinePending() || this.recordingPending());
  /** What the wait says it is waiting for, since two reads can be outstanding and a reader deserves the truth about which. */
  protected readonly pendingLine = computed(() => {
    if (this.timelinePending() && this.recordingPending()) return 'Reading the timeline and the recording…';
    return this.timelinePending() ? 'Reading the timeline…' : 'Reading the recording…';
  });

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
    return r ? buildFilm(r, this.game(), this.timeline(), this.previous(), this.opponent(), this.recording()) : undefined;
  });

  /**
   * Whether the walk has anything to show (11 Sep 2026): the tour is about the
   * map, the tape and the lab, and a film with no timeline has none of them.
   * Offering it there would cost the reader three seconds of "Finding it…" per
   * absent anchor before the engine gave up, so the pill simply stays away.
   */
  protected readonly hasWalk = computed(() => {
    const m = this.model();
    return !!m && !!(m.map || m.tape);
  });

  /** The film's look on the stage: `stock-*`, `title-*`, `motion-*`, `enter-*`, with the tempo and the ease as inline custom properties. */
  protected readonly stageClasses = computed(() => {
    const s = this.model()?.style;
    return s ? stageClasses(s) : [];
  });
  protected readonly tempo = computed(() => {
    const s = this.model()?.style;
    return s ? String(tempoOf(s)) : null;
  });
  protected readonly ease = computed(() => {
    const s = this.model()?.style;
    return s ? easeOf(s) : null;
  });

  protected readonly chapter = signal(0);
  protected readonly narrow = signal(false);
  /** Bumped on Escape: the chapters fold whatever they have open. */
  protected readonly escapeTick = signal(0);
  protected readonly progress = computed<FilmProgress | undefined>(() => this.prefs.filmProgress(this.matchId()));
  protected readonly calls = computed(() => this.progress()?.calls);
  /** The minute the reader said the game turned: written by the takeover's reel (the tape stopped asking on 10 Sep 2026), read by the tape for its verdict line. */
  protected readonly turnGuess = computed<number | undefined>(() => this.progress()?.calls?.['turn']);
  /** The second a shared link opened on (?t=), handed to the tape once; only Copy link ever writes it back. */
  protected readonly initialSec = signal<number | null>(null);
  /** The map's Watch it: the tape seeks to a little before the death and plays; its Work on this second: the tape seeks to the death and opens the lab (`lab`). */
  protected readonly seekRequest = signal<FilmSeekRequest | null>(null);
  /** The reminder is on until the card is reached, then whatever the toggle last said. */
  protected readonly askAgain = computed(() => {
    const p = this.progress();
    return !p?.done || !!p.nextAskAt;
  });
  protected readonly current = computed(() => this.model()?.chapters[this.chapter()]);

  private readonly deck = viewChild<ElementRef<HTMLElement>>('deck');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  /**
   * Whatever stands above the stage, measured, as `--topbar-h` on the stage (10 Sep 2026, second fix pass). The
   * stylesheet's value is a constant, but the topbar wrapped: below about 80rem, or whenever the activity pill showed
   * during a refresh, the user bar dropped to a second line and the header grew by a couple of rem, the fixed stage
   * overran the viewport by as much, and a wheel over a short chapter scrolled the page again. Since the film took the
   * whole screen (10 Sep 2026, evening) the shell hides the topbar on this route and the measure reads 0rem, which is
   * set as such: a zero is an answer, not a missing one. Null until measured, so the stylesheet's fallback stands
   * meanwhile and wherever layout cannot be read.
   */
  protected readonly topbarH = signal<string | null>(null);
  /**
   * The Riot notice's real height, measured, as `--film-under` on the stage (10 Sep 2026, evening). On the film route
   * the shell thins the notice to one line under the stage (it has to stay visible, policy), and the stage is the
   * viewport less that line: measured, because the line wraps on a narrow screen and the stylesheet's figure is a
   * guess for a wide one. Null until measured; the stylesheet's fallback stands meanwhile.
   */
  protected readonly filmUnder = signal<string | null>(null);
  /** When Escape was last pressed, for the second-press rule; 0 once it has been spent. */
  private lastEscapeAt = 0;
  private wanted: string | null = null;
  /**
   * Whether the url's ?c has been resolved onto a chapter yet. A signal, not a
   * plain field (12 Sep 2026): the chapter also goes back *into* the url, and
   * that write has to wait for this one to happen — with two reads outstanding
   * a deep link's placement lands a beat later, and the url writer, running
   * meanwhile on chapter 0, replaced ?c=map with ?c=title and then skipped its
   * own correction, because the snapshot it compares against still read "map"
   * while that navigation was in flight.
   */
  private readonly placed = signal(false);
  /** The card's write happens once a visit, and only on walking onto it from the chapter before. */
  private cardReached = false;
  /** True while the chapter on stage is fading out; a move during it lands without a second fade. */
  private leaving = false;
  /** Counts every move, so a fade that finishes after a later move does not land its stale target. */
  private moves = 0;

  /** The match the page last stood on, so a change of :matchId under a reused page is told from the first arrival. */
  private lastMatchId: string | null = null;

  constructor() {
    this.readQuery();
    this.watchWidth();

    // The timeline is read on demand, once, the way the review panel reads it.
    effect(() => {
      const r = this.review();
      if (r?.tier !== 'timeline' || this.timelines.known().has(r.matchId)) return;
      void this.timelines.load(r.matchId);
    });

    // And the recording, on the same road but for every game, whatever tier
    // the review came down. It is deliberately not gated on `review.recorded`:
    // that field arrived with review version 7, so a version 6 review of a
    // recorded game carries nothing to gate on, and gating would have dropped
    // the frames chapter in silence on exactly the games the recorder exists
    // for. A game with no recording costs one read that answers null and is
    // remembered for the session.
    effect(() => {
      const id = this.matchId();
      if (!id || this.recordings.known().has(id)) return;
      void this.recordings.load(id);
    });

    // ?c picks the chapter on arrival: an index, or a kind such as "seat".
    effect(() => {
      const m = this.model();
      if (!m || this.placed()) return;
      // The chapter list shifts when the timeline lands (the board gives way to the tape and the map) and again when
      // the recording does (the frames appear), so a kind is only resolved once the list is final: any ?c=<kind>
      // waits for both reads, not only the tape and the map (10 Sep 2026, second review: ?c=draft used to land on
      // the draft and then find The one thing on stage). The title card, chapter 0, is what shows meanwhile and
      // waits for nothing.
      const kind = this.wanted;
      if (kind && !/^\d+$/.test(kind) && this.pending()) return;
      this.placed.set(true);
      const i = this.resolveChapter(m, kind);
      untracked(() => void this.go(i));
    });

    // The title card links film to film and the route reuses this page: a new match starts over, with the new url's
    // ?c and ?t, and nothing of the last film's Watch it or card write carries into it (10 Sep 2026, second review).
    effect(() => {
      const id = this.matchId();
      untracked(() => {
        if (this.lastMatchId === id) return;
        const first = this.lastMatchId === null;
        this.lastMatchId = id;
        if (first) return;
        this.readQuery();
        this.seekRequest.set(null);
        this.placed.set(false);
        this.cardReached = false;
        this.chapter.set(0);
      });
    });

    // The chapter goes back into the url and this browser, so a link and the poster both know where the film is. It
    // waits for the url's own ?c to be resolved first: until then the chapter on the signal is the title card, and
    // writing that would overwrite the link the reader arrived on before it has been read.
    effect(() => {
      const m = this.model();
      const i = this.chapter();
      if (!m || !this.placed()) return;
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

    // What is above and below the stage is measured, not assumed: everything above the stage is the header (nothing,
    // since the shell hides it on this route), so the stage's own offset in the document is `--topbar-h`, and the
    // Riot notice under it is `--film-under`. Re-measured when either box changes (the topbar going as the route's
    // class lands, the activity pill coming and going mid-film, a font landing, the notice wrapping) and on a resize.
    afterRenderEffect((onCleanup) => {
      const el = this.stage()?.nativeElement;
      if (!el || typeof window === 'undefined') return;
      const measure = () => untracked(() => this.measureAround(el));
      measure();
      const watched = [document.querySelector('.topbar'), document.querySelector('.site-footer')].filter((x): x is Element => !!x);
      const ro = watched.length && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
      if (ro) watched.forEach((x) => ro.observe(x));
      window.addEventListener('resize', measure);
      onCleanup(() => {
        ro?.disconnect();
        window.removeEventListener('resize', measure);
      });
    });
  }

  /**
   * The stage's top edge in document space and the notice's height, in rem so they scale with the root size like every
   * other length. A measured zero above the stage is the film-route answer (the topbar is hidden) and is set as such;
   * only a box that cannot be read at all (jsdom gives every element no height) leaves the stylesheet's fallback standing.
   */
  private measureAround(stage: HTMLElement): void {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const asRem = (px: number) => `${Math.round((px / rem) * 1000) / 1000}rem`;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    this.topbarH.set(Number.isFinite(top) && top >= 0 ? asRem(top) : null);
    const under = document.querySelector('.site-footer')?.getBoundingClientRect().height ?? 0;
    this.filmUnder.set(under > 0 ? asRem(under) : null);
  }

  /** Back to the game's row on Games (a pill, never a link, 10 Sep 2026): the page's one way out, the bar's pill and a second Escape both take it. */
  protected goBack(): void {
    void this.router.navigate(['/games'], { queryParams: { match: this.matchId(), tab: 'games' } });
  }

  /**
   * A chapter closed something on the Escape just sent (the drawer, the full screen, a table, a note): that press was
   * spent on it, so the next Escape is a first press again rather than the second that leaves (10 Sep 2026, second fix pass).
   */
  protected onEscaped(): void {
    this.lastEscapeAt = 0;
  }

  /** What the url asks for on arrival: ?c is the chapter (?fresh=1 is the takeover's link, straight off a landing: the tape, where the guess it took reveals), ?t the tape's second. */
  private readQuery(): void {
    const q = this.route.snapshot.queryParamMap;
    this.wanted = q.get('c') ?? (q.get('fresh') === '1' ? 'tape' : null);
    const t = Number(q.get('t'));
    this.initialSec.set(q.has('t') && Number.isFinite(t) && t >= 0 ? Math.round(t) : null);
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
    // A tour owns the keyboard while it walks (11 Sep 2026): the overlay reads
    // Escape as "skip" and the arrows as "step", and it only calls
    // `preventDefault`, so without this the same Escape would also arm the
    // film's leave-in-two rule and an arrow would change the chapter under the
    // ring. One press, one meaning.
    if (this.tours.active()) return;
    if (event.key === 'Escape') {
      // Escape works with or without a film on the stage (the empty page has nowhere else to go): once folds what a chapter
      // has open, twice within the window goes Back. The chapter's `escaped`, handled in `onEscaped` during the change
      // detection this tick wakes, clears `lastEscapeAt` again when the press closed something.
      const now = Date.now();
      if (this.lastEscapeAt && now - this.lastEscapeAt <= ESCAPE_TWICE_MS) {
        this.lastEscapeAt = 0;
        this.goBack();
        return;
      }
      this.lastEscapeAt = now;
      this.escapeTick.set(this.escapeTick() + 1);
      return;
    }
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

  /** The map's Watch it: go to the tape and ask it for the second, twenty seconds before the death. */
  protected onWatch(sec: number): void {
    const m = this.model();
    if (!m) return;
    const i = m.chapters.findIndex((c) => c.kind === 'tape');
    if (i < 0) return;
    const at = Math.max(0, Math.round(sec) - WATCH_LEAD_SEC);
    this.seekRequest.set({ sec: at, n: (this.seekRequest()?.n ?? 0) + 1, play: true });
    void this.go(i);
  }

  /** The map's Work on this second (Part C, 10 Sep 2026): go to the tape and ask it to open the position lab on the death's own second, standing, not playing. */
  protected onLab(sec: number): void {
    const m = this.model();
    if (!m) return;
    const i = m.chapters.findIndex((c) => c.kind === 'tape');
    if (i < 0) return;
    this.seekRequest.set({ sec: Math.max(0, Math.round(sec)), n: (this.seekRequest()?.n ?? 0) + 1, lab: true });
    void this.go(i);
  }

  /** The tape's Copy link: the second goes into the url too, so the address bar matches what was copied. */
  protected onCopied(sec: number): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { t: sec }, queryParamsHandling: 'merge', replaceUrl: true });
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

  /**
   * Reaching the card is finishing the film: the time, the calls, and the
   * first reminder if none was ever set and the review has something to
   * remind of (since 10 Sep 2026 `reminderFor` reads a one thing, a work-on
   * or a commitment somebody picked on, never a lesson); a reminder with
   * nothing behind it would only stand in front of the next film's. Once a visit.
   */
  private reachCard(): void {
    const id = this.matchId();
    if (!id || this.cardReached) return;
    this.cardReached = true;
    const p = this.progress();
    const done = p?.done ?? new Date().toISOString();
    const patch: Partial<FilmProgress> = { done, calls: p?.calls ?? {} };
    const review = this.review();
    const m = this.model();
    if (p?.asked === undefined && review && m && reminderFor(review, {}, this.data.commitmentFor(id), m.seed)) {
      patch.nextAskAt = nextAskAt(done, 0);
      patch.asked = 0;
    }
    void this.prefs.saveFilmProgress(id, patch);
  }
}
