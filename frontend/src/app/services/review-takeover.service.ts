import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { CompExpectation } from '../models/team.models';
import { GameReviewService } from './game-review.service';
import { MatchTimelineService } from './match-timeline.service';
import { TeamDataService } from './team-data.service';
import { ToastService } from './toast.service';

/**
 * Where the takeover is: `gate` asks before any money is spent, `reel` plays
 * the game while the coach writes, `holding` is the reel finished and the
 * review not yet back, `landed` is the review in, `error` the failure.
 * `closed` is off screen, which after Roll it means minimised: the call
 * runs on and the landing effect still watches.
 */
export type TakeoverPhase = 'closed' | 'gate' | 'reel' | 'holding' | 'landed' | 'error';

/** The Review button's box, so the stage can grow out of it and shrink back. */
export interface TakeoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The review takeover's state (9 Sep 2026): one game at a time, opened from
 * a row's Review button, rolled into a review call, and landed when the
 * stored document comes back through the listener. The component in
 * `shared/review-takeover.component.ts` draws it; this owns the phase, the
 * clock it started at, the watch for the landing and the failure, and the
 * "ready" mark a row's Film room pill pulses on when the review landed
 * while the takeover was minimised.
 *
 * The landing guard is `Date.parse(reviewedAt) > t0`: a review already on
 * the row (a re-review) never lands the new one early. The function also
 * returns the document it wrote; its `reviewedAt` is kept as a second key,
 * so a clock a little ahead of the server still lands the right document.
 */
@Injectable({ providedIn: 'root' })
export class ReviewTakeoverService {
  private readonly reviews = inject(GameReviewService);
  private readonly timelines = inject(MatchTimelineService);
  private readonly data = inject(TeamDataService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly phase = signal<TakeoverPhase>('closed');
  readonly matchId = signal<string | null>(null);
  /** When Roll it was pressed, in ms since the epoch; 0 before it. */
  readonly t0 = signal(0);
  readonly fromRect = signal<TakeoverRect | null>(null);
  readonly expect = signal<CompExpectation | null>(null);
  readonly error = signal('');
  /** True from Roll it until the review lands or fails, minimised or not. */
  readonly rolling = signal(false);
  /** The game already has a review, so the gate asks "again". */
  readonly again = computed(() => !!this.data.reviewFor(this.matchId() ?? undefined));
  readonly minimised = computed(() => this.rolling() && this.phase() === 'closed');
  /** The element focus goes back to on close; not a signal, nothing renders off it. */
  fromEl: HTMLElement | null = null;

  /** The `reviewedAt` the function answered with, once it has. */
  private readonly landAt = signal<string | null>(null);
  private readonly readyIds = signal<ReadonlySet<string>>(new Set());
  /** Reviews still running from a takeover that was minimised and then opened on another game: each still lands as a toast. */
  private readonly parked = signal<readonly ParkedWatch[]>([]);

  constructor() {
    // The landing: a review written after Roll it, or the very document the function answered with.
    effect(() => {
      const id = this.matchId();
      if (!id || !this.rolling()) return;
      const review = this.data.reviewFor(id);
      if (!review) return;
      const written = Date.parse(review.reviewedAt);
      const landed = review.reviewedAt === this.landAt() || (Number.isFinite(written) && written > this.t0());
      if (landed) untracked(() => this.land(id));
    });

    // The failure: the review service keeps the message per match.
    effect(() => {
      const id = this.matchId();
      if (!id || !this.rolling()) return;
      const message = this.reviews.errorFor(id);
      if (!message) return;
      untracked(() => {
        this.rolling.set(false);
        // Minimised: the activity board's own toast has already said so.
        if (this.phase() === 'closed') return;
        this.error.set(message);
        this.phase.set('error');
      });
    });

    // The parked watches land or fail the way a minimised one does; the failure toast is the activity board's.
    effect(() => {
      for (const w of this.parked()) {
        const review = this.data.reviewFor(w.id);
        const written = review ? Date.parse(review.reviewedAt) : NaN;
        const landed = !!review && (review.reviewedAt === w.landAt || (Number.isFinite(written) && written > w.t0));
        const failed = !!this.reviews.errorFor(w.id);
        if (!landed && !failed) continue;
        untracked(() => {
          this.parked.update((list) => list.filter((x) => x.id !== w.id));
          if (landed) this.announce(w.id);
        });
      }
    });
  }

  /** The gate, before anything is spent. A takeover minimised on another game keeps that watch parked, so its landing still says so. */
  open(matchId: string, expect: CompExpectation | null, fromRect: DOMRect | TakeoverRect | null, fromEl: HTMLElement | null = null): void {
    if (this.phase() !== 'closed') return;
    const running = this.matchId();
    if (this.rolling() && running && running !== matchId) {
      const watch: ParkedWatch = { id: running, t0: this.t0(), landAt: this.landAt() };
      this.parked.update((list) => [...list.filter((x) => x.id !== running), watch]);
      this.rolling.set(false);
    }
    this.matchId.set(matchId);
    this.expect.set(expect);
    this.fromRect.set(fromRect ? { x: fromRect.x, y: fromRect.y, width: fromRect.width, height: fromRect.height } : null);
    this.fromEl = fromEl;
    this.error.set('');
    this.landAt.set(null);
    this.phase.set('gate');
  }

  /** Roll it: the review call and the timeline read start; the reel is on. */
  roll(): void {
    const id = this.matchId();
    if (!id || this.phase() !== 'gate') return;
    this.t0.set(Date.now());
    this.error.set('');
    this.landAt.set(null);
    this.rolling.set(true);
    this.phase.set('reel');
    void this.timelines.load(id);
    // Not awaited for the screen: the document lands through the listener. The service catches its own failures; this catch is for anything else.
    this.reviews
      .review(id, this.expect())
      .then((review) => {
        if (!review?.reviewedAt) return;
        // The takeover may have moved on to another game by now: the key goes to whichever watch holds this one.
        if (this.matchId() === id) this.landAt.set(review.reviewedAt);
        else this.parked.update((list) => list.map((w) => (w.id === id ? { ...w, landAt: review.reviewedAt } : w)));
      })
      .catch((error: unknown) => {
        if (!this.rolling()) return;
        this.rolling.set(false);
        if (this.phase() === 'closed') return;
        this.error.set(error instanceof Error ? error.message : 'The review failed.');
        this.phase.set('error');
      });
  }

  /** The reel is over and the review not back: hold. */
  hold(): void {
    if (this.phase() === 'reel') this.phase.set('holding');
  }

  /** Off screen, the call still running; Escape and the Minimise pill. Before Roll it, the same as Not now. A review that landed while the stage was shrinking is announced as a minimised one. */
  minimise(): void {
    if (this.phase() === 'landed') {
      const id = this.matchId();
      this.close();
      if (id) this.announce(id);
      return;
    }
    if (!this.rolling()) {
      this.close();
      return;
    }
    this.phase.set('closed');
  }

  /** Off screen and done: Not now, Close on a failure, both pills on the landing. */
  close(): void {
    this.phase.set('closed');
    this.rolling.set(false);
    this.error.set('');
  }

  /** A review landed while minimised and nobody has opened it yet: the row's Film room pill pulses. */
  ready(matchId: string | undefined): boolean {
    return !!matchId && this.readyIds().has(matchId);
  }

  clearReady(matchId: string | undefined): void {
    if (!matchId || !this.readyIds().has(matchId)) return;
    this.readyIds.update((s) => {
      const next = new Set(s);
      next.delete(matchId);
      return next;
    });
  }

  private land(id: string): void {
    this.rolling.set(false);
    if (this.phase() === 'closed') {
      this.announce(id);
      return;
    }
    this.reread(id);
    this.phase.set('landed');
  }

  /** The review fetched the timeline for a fresh game; a stale "absent" must not stand. */
  private reread(id: string): void {
    this.timelines.forget(id);
    void this.timelines.load(id);
  }

  /** A review landed with no stage to show it on: the row's pill pulses and a toast carries the Open pill. */
  private announce(id: string): void {
    this.reread(id);
    this.readyIds.update((s) => new Set(s).add(id));
    this.toast.show('The film is ready', {
      kind: 'ok',
      icon: 'movie',
      timeout: 15000,
      action: {
        label: 'Open',
        run: () => {
          this.clearReady(id);
          void this.router.navigate(['/film', id], { queryParams: { fresh: 1 } });
        }
      }
    });
  }
}

/** A review still running after the takeover moved on to another game. */
interface ParkedWatch {
  id: string;
  t0: number;
  landAt: string | null;
}
