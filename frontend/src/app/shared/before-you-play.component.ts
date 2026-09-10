import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { advance, dueReminders, FilmReminder, reminderFor } from '../core/film-progress';
import { isFirebaseConfigured } from '../core/firebase';
import { seedOf } from '../core/seed';
import { GameReview } from '../models/team.models';
import { TeamDataService } from '../services/team-data.service';
import { UserPrefsService } from '../services/user-prefs.service';
import { FilmGlyphComponent } from './film/film-glyph.component';

/** What the card shows: the film it is about, its headline, and the lines to remind of. */
interface ReminderItem {
  matchId: string;
  headline: string;
  reminder: FilmReminder;
}

/**
 * Before you play (10 Sep 2026): one card at the top of Games and in the
 * top of Games when a film's reminder is due (the roster quick actions dropped it on 10 Sep 2026). It reminds, it never
 * asks (the lead, 10 Sep 2026: "not needed for the call-back question, just
 * a reminder on what to do"): the film's headline muted, then one short line
 * each with the film's own glyph, the one thing under a flag, what the team
 * committed to under a check, this person's own seat's ask under footsteps,
 * and up to two further asks under a smaller flag, each labelled "Also" (10
 * Sep 2026: these were the lessons' whys for a day, which explain an answer
 * and read as fragments; the other work-ons and this person's own further
 * points are things to do). Got it pushes the reminder up
 * the ladder (a day, three, seven, then never) exactly as Done did, so the
 * next due film comes up or the card goes; Open the card routes to the film's
 * card. The reminder lives in this person's own prefs, so the card is theirs
 * alone, and it never shows in the draft room. Nothing here without Firebase:
 * the prefs would not hold. A due film with nothing to remind of (a version 3
 * review with no work-on that nobody committed on) is switched off rather
 * than left in the way, so the film after it gets its turn. `compact` drops
 * the card chrome and the film's headline, for a host that is a card already.
 */
@Component({
  selector: 'app-before-you-play',
  imports: [FilmGlyphComponent],
  template: `
    @if (item(); as it) {
      <section class="before-you-play" [class.card]="!compact()" [class.is-compact]="compact()" aria-label="Before you play">
        <p class="byp-kicker"><span class="material-symbols-rounded" aria-hidden="true">sports_esports</span> Before you play</p>
        @if (it.headline && !compact()) { <p class="byp-film">{{ it.headline }}</p> }
        <ul class="list-clean byp-lines">
          @if (it.reminder.oneThing) {
            <li class="byp-line is-one"><app-film-glyph name="flag" [size]="1.15" label="The one thing" /><span>{{ it.reminder.oneThing }}</span></li>
          }
          @if (it.reminder.commitment) {
            <li class="byp-line is-commit"><app-film-glyph name="check" [size]="1.15" label="We committed to" /><span>{{ it.reminder.commitment }}</span></li>
          }
          @if (it.reminder.ask) {
            <li class="byp-line is-ask"><app-film-glyph name="footsteps" [size]="1.15" label="Your seat" /><span>{{ it.reminder.ask }}</span></li>
          }
          @for (line of it.reminder.more ?? []; track line) {
            <li class="byp-line is-more"><app-film-glyph name="flag" [size]="1" label="Also" /><span>{{ line }}</span></li>
          }
        </ul>
        <div class="byp-actions">
          <button type="button" class="view-btn active" (click)="gotIt()"><span class="material-symbols-rounded" aria-hidden="true">check</span> Got it</button>
          <button type="button" class="view-btn" (click)="openCard(it.matchId)"><span class="material-symbols-rounded" aria-hidden="true">movie</span> Open the card</button>
        </div>
      </section>
    }
  `
})
export class BeforeYouPlayComponent {
  private readonly data = inject(TeamDataService);
  private readonly prefs = inject(UserPrefsService);
  private readonly router = inject(Router);

  /** No card chrome and no headline: the host is a card already (no host uses it since 10 Sep 2026; kept for a future host). */
  readonly compact = input<boolean>(false);

  /** The clock the reminders are read against, a minute at a time, so one falling due while the page is open shows without a navigation. */
  private readonly now = signal(new Date().toISOString());

  /** The seat this person said is theirs in the film room, so the card can carry their own ask. */
  private readonly seat = computed(() => this.prefs.prefs().film?.seat);

  /** The due films with a review loaded, earliest first, each with what it would remind of (null when it has nothing to). */
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

  /** The earliest due film with something to remind of, or nothing and the card stays away. */
  protected readonly item = computed<ReminderItem | null>(() => {
    const first = this.candidates().find((c) => c.reminder !== null);
    return first ? { matchId: first.matchId, headline: first.reminder!.headline || headlineOf(first.review), reminder: first.reminder! } : null;
  });

  constructor() {
    const tick = setInterval(() => this.now.set(new Date().toISOString()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    // A due film whose review is here but has nothing to remind of is switched off, so it never stands in front of the next one.
    effect(() => {
      for (const c of this.candidates()) {
        if (c.reminder === null) void this.prefs.saveFilmProgress(c.matchId, { nextAskAt: undefined });
      }
    });
  }

  /** Got it: one step up the ladder, the same step Done took when the card still asked. */
  protected gotIt(): void {
    const it = this.item();
    if (!it) return;
    const progress = this.prefs.filmProgress(it.matchId) ?? {};
    void this.prefs.saveFilmProgress(it.matchId, advance(progress, new Date().toISOString()));
  }

  /** The film's card, where the whole of it is. */
  protected openCard(matchId: string): void {
    void this.router.navigate(['/film', matchId], { queryParams: { c: 'card' } });
  }
}

/** The film's headline when the review carries none: the first sentence of the summary. */
function headlineOf(review: GameReview): string {
  const m = (review.team.summary ?? '').match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : (review.team.summary ?? '')).trim();
}
