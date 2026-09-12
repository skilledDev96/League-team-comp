import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { advance, dueReminders, reminderFor } from '../core/film-progress';
import { isFirebaseConfigured } from '../core/firebase';
import { NextUpCard, NextUpGame, NextUpLine, nextUp } from '../core/next-up';
import { nextOpenSeries } from '../core/series-results';
import { seedOf } from '../core/seed';
import { GameReview } from '../models/team.models';
import { AuthService } from '../services/auth.service';
import { TeamDataService } from '../services/team-data.service';
import { UserPrefsService } from '../services/user-prefs.service';
import { TournamentContextService } from '../pages/tournaments/tournament-context.service';
import { FilmGlyphComponent } from './film/film-glyph.component';

/**
 * The one card at the top of Games that says what to do next (12 Sep 2026).
 *
 * It **replaces** "Before you play" rather than sitting above it. Two cards at the top of the
 * page is the complaint this work is answering, restated — so the film reminder became one rung
 * of a ladder (`core/next-up.ts`) instead of a card of its own, and everything that card did is
 * still here: Got it walks the reminder up the ladder a day, three, seven, then never; Open the
 * card goes to the film's card; a due film with nothing to remind of is switched off so the next
 * one gets its turn; and the reminder rung needs Firebase, because the ladder would not hold
 * without it.
 *
 * What each rung offers is decided here rather than in `next-up.ts`, because one of the pills is
 * not a route: Got it writes to this person's prefs.
 *
 * An unwatched review is **not** a rung — it fired for nearly everyone nearly always, so the card
 * stopped carrying news. That prompt lives on the game's own row, where the Reviewed chip opens
 * the film room.
 */
@Component({
  selector: 'app-next-up',
  imports: [FilmGlyphComponent],
  template: `
    @if (card(); as c) {
      <section class="card next-up" [attr.data-next-up]="c.kind" aria-label="Next up">
        <p class="next-up-kicker">
          <span class="material-symbols-rounded" aria-hidden="true">{{ icon(c.kind) }}</span> {{ c.kicker }}
        </p>
        <p class="next-up-head">{{ c.headline }}</p>
        @if (c.lines.length) {
          <ul class="list-clean next-up-lines">
            @for (line of c.lines; track line.text) {
              <li class="next-up-line">
                <app-film-glyph [name]="line.glyph" [size]="1.15" [label]="line.label" />
                <span>{{ line.text }}</span>
              </li>
            }
          </ul>
        }
        <div class="next-up-actions">
          @switch (c.kind) {
            @case ('remind') {
              <button type="button" class="view-btn active" (click)="gotIt()">
                <span class="material-symbols-rounded" aria-hidden="true">check</span> Got it
              </button>
              <button type="button" class="view-btn" (click)="openCard(c.matchId!)">
                <span class="material-symbols-rounded" aria-hidden="true">movie</span> Open the card
              </button>
            }
            @case ('ask') {
              <button type="button" class="view-btn active" (click)="openGame(c.matchId!)">
                <span class="material-symbols-rounded" aria-hidden="true">rate_review</span> Review this game
              </button>
            }
            @case ('draft') {
              @if (auth.canEdit()) {
                <button type="button" class="view-btn active" (click)="openDraft(c.seriesId!)">
                  <span class="material-symbols-rounded" aria-hidden="true">swords</span> Open the draft
                </button>
                <button type="button" class="view-btn" (click)="openPlan()">
                  <span class="material-symbols-rounded" aria-hidden="true">description</span> The plan
                </button>
              } @else {
                <button type="button" class="view-btn active" (click)="openPlan()">
                  <span class="material-symbols-rounded" aria-hidden="true">search</span> Scout them
                </button>
              }
            }
          }
        </div>
      </section>
    }
  `
})
export class NextUpComponent {
  private readonly data = inject(TeamDataService);
  private readonly prefs = inject(UserPrefsService);
  private readonly ctx = inject(TournamentContextService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  /** Read a minute at a time, so a reminder falling due while the page is open shows without a navigation. */
  private readonly now = signal(new Date().toISOString());

  /** The seat this person said is theirs in the film room, so the reminder can carry their own ask. */
  private readonly seat = computed(() => this.prefs.prefs().film?.seat);

  /** Which games we have an opponent name for, so a card can say "the Sunset Wolves game". */
  private readonly opponentOf = computed(() => {
    const bySeries = new Map(this.data.tournamentSeries().map((s) => [s.id, s.opponent]));
    const out = new Map<string, string>();
    for (const game of this.data.seriesGames()) {
      const name = game.matchId ? bySeries.get(game.seriesId) : undefined;
      if (game.matchId && name) out.set(game.matchId, name);
    }
    return out;
  });

  private readonly played = computed<NextUpGame[]>(() => {
    const names = this.opponentOf();
    return (this.data.compAnalysis()?.games ?? []).map((g) => ({
      matchId: g.matchId,
      when: g.date,
      opponent: names.get(g.matchId)
    }));
  });

  private readonly unreviewed = computed<NextUpGame[]>(() => {
    const reviewed = new Set(this.data.gameReviews().map((r) => r.matchId));
    return this.played().filter((g) => !reviewed.has(g.matchId));
  });

  /** The due films with a review loaded, earliest first, each with what it would remind of. */
  private readonly candidates = computed(() => {
    if (!isFirebaseConfigured()) return [];
    const seat = this.seat();
    return dueReminders(this.prefs.prefs().film, this.now()).flatMap((due) => {
      const review = this.data.reviewFor(due.matchId);
      if (!review) return [];
      const reminder = reminderFor(review, due.progress, this.data.commitmentFor(due.matchId), seedOf(due.matchId), seat);
      return [{ matchId: due.matchId, review, reminder }];
    });
  });

  /** The earliest due film with something to remind of, as the lines the card draws. */
  private readonly reminder = computed(() => {
    const first = this.candidates().find((c) => c.reminder !== null);
    if (!first) return null;
    const r = first.reminder!;
    const lines: NextUpLine[] = [];
    if (r.oneThing) lines.push({ glyph: 'flag', label: 'The one thing', text: r.oneThing });
    if (r.commitment) lines.push({ glyph: 'check', label: 'We committed to', text: r.commitment });
    if (r.ask) lines.push({ glyph: 'footsteps', label: 'Your seat', text: r.ask });
    for (const more of r.more ?? []) lines.push({ glyph: 'flag', label: 'Also', text: more });
    return { matchId: first.matchId, headline: r.headline || headlineOf(first.review), lines };
  });

  /**
   * The next opponent: the first series of a real tournament with no result yet. Scrim groups are
   * left out — they are a standing list of teams rather than a schedule, so their "next" is
   * whichever was prepped last and means nothing.
   */
  private readonly nextSeries = computed(() => {
    // Only the one still ahead: a finished bracket has nothing to draft. core/series-results.ts, shared with Home.
    const series = nextOpenSeries({ tournaments: this.data.tournaments(), series: this.data.tournamentSeries(), seriesGames: this.data.seriesGames() });
    return series ? { id: series.id, opponent: series.opponent, when: whenOf(series.scheduledAt) } : null;
  });

  protected readonly card = computed<NextUpCard | null>(() =>
    nextUp({
      reminder: this.reminder(),
      unreviewed: this.unreviewed(),
      nextSeries: this.nextSeries(),
      canEdit: this.auth.canEdit(),
      now: Date.parse(this.now())
    })
  );

  constructor() {
    const tick = setInterval(() => this.now.set(new Date().toISOString()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    // A due film whose review is here but has nothing to remind of is switched off, so it never
    // stands in front of the next one.
    effect(() => {
      for (const c of this.candidates()) {
        if (c.reminder === null) void this.prefs.saveFilmProgress(c.matchId, { nextAskAt: undefined });
      }
    });
  }

  protected icon(kind: NextUpCard['kind']): string {
    return { remind: 'sports_esports', ask: 'rate_review', draft: 'event_upcoming' }[kind];
  }

  /** Got it: one step up the ladder, the same step Done took when the card still asked. */
  protected gotIt(): void {
    const matchId = this.card()?.matchId;
    if (!matchId) return;
    const progress = this.prefs.filmProgress(matchId) ?? {};
    void this.prefs.saveFilmProgress(matchId, advance(progress, new Date().toISOString()));
  }

  protected openCard(matchId: string): void {
    void this.router.navigate(['/film', matchId], { queryParams: { c: 'card' } });
  }

  protected openGame(matchId: string): void {
    void this.router.navigate(['/games'], { queryParams: { match: matchId } });
  }

  protected openDraft(seriesId: string): void {
    void this.ctx.draftSeries(seriesId);
  }

  protected openPlan(): void {
    void this.router.navigate(['/tournaments'], { queryParams: { view: 'plan' } });
  }
}

/** The film's headline when the review carries none: the first sentence of the summary. */
function headlineOf(review: GameReview | undefined): string {
  const summary = review?.team.summary ?? '';
  const m = summary.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : summary).trim();
}

/** "on Sunday", "today" — the words that go after "You play X". Nothing for free text we cannot read. */
function whenOf(scheduledAt: string | undefined): string | undefined {
  if (!scheduledAt) return undefined;
  const at = Date.parse(scheduledAt);
  if (Number.isNaN(at)) return undefined;
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return `on ${new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}`;
  return undefined;
}
