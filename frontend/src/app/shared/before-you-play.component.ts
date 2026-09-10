import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { advance, dueReminders, reminderFor } from '../core/film-progress';
import { FilmCall } from '../core/film-model';
import { isFirebaseConfigured } from '../core/firebase';
import { seedOf } from '../core/seed';
import { GameReview } from '../models/team.models';
import { TeamDataService } from '../services/team-data.service';
import { UserPrefsService } from '../services/user-prefs.service';

/** What the card shows: the film it is about and the one thing it asks. */
interface ReminderItem {
  matchId: string;
  headline: string;
  call: FilmCall;
}

/**
 * Before you play (10 Sep 2026): one card at the top of Games and in the
 * roster's quick actions when a film's reminder is due, asking one thing the
 * film taught: a lesson from the review (version 4), else which of the two
 * choices the team committed to. A tap marks it right or wrong and shows the
 * fact; Done or Not now pushes the reminder up the ladder (a day, three,
 * seven, then never). The reminder lives in this person's own prefs, so the
 * card is theirs alone, and it never shows in the draft room. Nothing here
 * without Firebase: the prefs would not hold. A due film with nothing to ask
 * (a version 3 review nobody committed on) is switched off rather than left
 * in the way, so the film after it gets its turn. `compact` drops the card
 * chrome and the film's headline, for a host that is a card already.
 */
@Component({
  selector: 'app-before-you-play',
  imports: [RouterLink],
  template: `
    @if (item(); as it) {
      <section class="before-you-play" [class.card]="!compact()" [class.is-compact]="compact()" aria-label="Before you play">
        <p class="byp-kicker"><span class="material-symbols-rounded" aria-hidden="true">sports_esports</span> Before you play</p>
        @if (it.headline && !compact()) { <p class="byp-film">{{ it.headline }}</p> }
        <p class="byp-q">{{ it.call.question }}</p>
        <div class="byp-options" role="group" [attr.aria-label]="it.call.question">
          @for (opt of it.call.options; track $index; let i = $index) {
            <button
              type="button"
              class="view-btn byp-option"
              [class.is-right]="picked() !== null && i === it.call.answer"
              [class.is-wrong]="picked() === i && i !== it.call.answer"
              [disabled]="picked() !== null"
              [attr.aria-pressed]="picked() === i"
              (click)="pick(i)"
            >{{ opt }}</button>
          }
        </div>
        @if (picked() !== null) {
          <p class="byp-why" [class.is-ok]="right()" [class.is-warn]="!right()"><b>{{ right() ? 'Called it.' : 'Not this time.' }}</b> {{ it.call.why }}</p>
        }
        <div class="byp-actions">
          @if (picked() !== null) {
            <button type="button" class="view-btn active" (click)="done()"><span class="material-symbols-rounded" aria-hidden="true">check</span> Done</button>
          } @else {
            <button type="button" class="view-btn" (click)="done()">Not now</button>
          }
          <a class="view-btn" [routerLink]="['/film', it.matchId]" [queryParams]="{ c: 'card' }"><span class="material-symbols-rounded" aria-hidden="true">movie</span> Open the card</a>
        </div>
      </section>
    }
  `
})
export class BeforeYouPlayComponent {
  private readonly data = inject(TeamDataService);
  private readonly prefs = inject(UserPrefsService);

  /** No card chrome and no headline: the host is a card already (the roster's quick actions). */
  readonly compact = input<boolean>(false);

  /** The option tapped on the film the card is showing; cleared when another film comes up. */
  private readonly answer = signal<{ matchId: string; i: number } | null>(null);

  /** The clock the reminders are read against, a minute at a time, so one falling due while the page is open shows without a navigation. */
  private readonly now = signal(new Date().toISOString());

  /** The due films with a review loaded, earliest first, each with what it would ask (null when it has nothing to). */
  private readonly candidates = computed(() => {
    if (!isFirebaseConfigured()) return [];
    return dueReminders(this.prefs.prefs().film, this.now()).flatMap((due) => {
      const review = this.data.reviewFor(due.matchId);
      if (!review) return [];
      const call = reminderFor(review, due.progress, this.data.commitmentFor(due.matchId), seedOf(due.matchId));
      return [{ matchId: due.matchId, review, call }];
    });
  });

  /** The earliest due film with something to ask, or nothing and the card stays away. */
  protected readonly item = computed<ReminderItem | null>(() => {
    const first = this.candidates().find((c) => c.call !== null);
    return first ? { matchId: first.matchId, headline: headlineOf(first.review), call: first.call! } : null;
  });

  constructor() {
    const tick = setInterval(() => this.now.set(new Date().toISOString()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    // A due film whose review is here but has nothing to ask is switched off, so it never stands in front of the next one.
    effect(() => {
      for (const c of this.candidates()) {
        if (c.call === null) void this.prefs.saveFilmProgress(c.matchId, { nextAskAt: undefined });
      }
    });
  }

  protected readonly picked = computed<number | null>(() => {
    const a = this.answer();
    const it = this.item();
    return a && it && a.matchId === it.matchId ? a.i : null;
  });

  protected readonly right = computed(() => {
    const it = this.item();
    const i = this.picked();
    return !!it && i !== null && i === it.call.answer;
  });

  protected pick(i: number): void {
    const it = this.item();
    if (!it || this.picked() !== null) return;
    this.answer.set({ matchId: it.matchId, i });
  }

  /** Done after an answer, or Not now without one: the same step up the ladder. */
  protected done(): void {
    const it = this.item();
    if (!it) return;
    const progress = this.prefs.filmProgress(it.matchId) ?? {};
    void this.prefs.saveFilmProgress(it.matchId, advance(progress, new Date().toISOString()));
    this.answer.set(null);
  }
}

/** The film's headline: the review's own, else the first sentence of the summary. */
function headlineOf(review: GameReview): string {
  const headline = review.team.headline?.trim();
  if (headline) return headline;
  const m = (review.team.summary ?? '').match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : (review.team.summary ?? '')).trim();
}
