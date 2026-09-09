import { afterRenderEffect, Component, computed, effect, ElementRef, HostListener, inject, input, signal, untracked, viewChild, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { boardCountsOf, reelTallyOf, tapeEventsOf, TapePlayer } from '../core/film-build';
import { createFilmClock, FilmClock } from '../core/film-clock';
import { scoreline } from '../core/review-view';
import { MatchTimeline, Role, ROLES } from '../models/team.models';
import { MatchTimelineService } from '../services/match-timeline.service';
import { MotionService } from '../services/motion.service';
import { ReviewTakeoverService } from '../services/review-takeover.service';
import { TeamDataService } from '../services/team-data.service';
import { UiService } from '../services/ui.service';
import { UserPrefsService } from '../services/user-prefs.service';
import { clockText, FilmScrubberComponent } from './film/film-scrubber.component';
import { RiftMapComponent } from './film/rift-map.component';
import { TooltipDirective } from './tooltip.directive';

/** The whole game plays in about this many real seconds. */
const REEL_SEC = 45;
/** How many of the facts' lines caption the reel, one every six seconds or so. */
const MAX_CAPTIONS = 7;
/** Every this many seconds, a game whose timeline is still being fetched is asked for again. */
const TIMELINE_POLL_SEC = 15;
const SPLASH_EVERY_SEC = 12;
const STATUS_EVERY_SEC = 8;
const STILL_WRITING_SEC = 60;
const FLIP_MS = 420;
const SHRINK_MS = 320;
const FLIP_EASE = 'cubic-bezier(0.2, 0.9, 0.3, 1)';

const STATUSES = ['Asking what decided it', 'A note per player', 'Checking every point against a fact'];

/** Riot's positions and the seat words both appear on `AnalysisPlayer.position`, depending on the source. */
const POSITION_SEAT: Record<string, Role> = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support', Top: 'Top', Jungle: 'Jungle', Mid: 'Mid', ADC: 'ADC', Support: 'Support' };

function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : text).trim();
}

/**
 * The takeover's stage (9 Sep 2026): everything after Roll it. Rendered by
 * `ReviewTakeoverComponent` inside a deferred block, so the Rift, the
 * scrubber and the film's builders load with it and not with the app
 * shell. It grows out of the gate card (the FLIP through MotionService),
 * takes focus, and while the coach writes plays the game on the Rift in
 * about forty-five seconds off one film clock: the counters tick as deaths
 * pass, the facts caption it, and the reader is asked where it turned; the
 * curve stays hidden so the guess is a guess. Without a timeline the totals
 * reel stands in. Then it holds, honestly: an elapsed dial, not a progress
 * bar. The landing is the review coming back through the listener; the
 * pills open the film room or leave the summary on the row. Minimise and
 * Escape shrink it back to the button and the call runs on. With motion
 * off it appears in place with every mark placed, the facts as a list and
 * the guess as a native range.
 */
@Component({
  selector: 'app-review-takeover-stage',
  imports: [RiftMapComponent, FilmScrubberComponent, TooltipDirective],
  host: { style: 'display: contents' },
  template: `
        <div class="rt-stage" #stage role="dialog" aria-modal="true" aria-live="polite" [attr.aria-label]="ariaLabel()" tabindex="-1"
             [class.is-landed]="phase() === 'landed'" [class.is-error]="phase() === 'error'" [class.is-totals]="!timeline()">
          <header class="rt-head">
            <span class="rt-kicker"><span class="material-symbols-rounded" aria-hidden="true">movie</span> Film room</span>
            <h2 class="rt-title">
              @for (w of titleWords(); track titleKey() + ':' + $index) {
                <span class="film-word" [style.--i]="$index">{{ w }}</span>{{ $last ? '' : ' ' }}
              }
            </h2>
            <div class="rt-head-pills">
              @if (phase() !== 'error') {
                <button type="button" class="view-btn" appTip="Shrink this away; the review keeps writing and the row says when it lands (Escape)" (click)="minimise()">
                  <span class="material-symbols-rounded" aria-hidden="true">close_fullscreen</span> Minimise
                </button>
              }
            </div>
          </header>

          <div class="rt-body">
            <div class="rt-main">
              @if (timeline(); as tl) {
                <div class="rt-map" [class.is-held]="phase() !== 'landed'">
                  <app-rift-map [events]="events()" [until]="t()">
                    <span caption aria-live="off">
                      @if (tally(); as n) {
                        <b class="rt-count">{{ n.deaths }}</b> {{ n.deaths === 1 ? 'death' : 'deaths' }} of ours so far
                        · <b class="rt-count">{{ n.dark }}</b> with no ward nearby
                        · <b class="rt-count">{{ n.close }}</b> with their jungler close
                      }
                    </span>
                  </app-rift-map>
                  <span class="rt-clock" aria-live="off">{{ clock() }}</span>
                </div>
                @if (locked() === null) {
                  <app-film-scrubber
                    [durationSec]="tl.durationSec"
                    [goldDiff]="[]"
                    [t]="t()"
                    [revealed]="false"
                    [guess]="guess()"
                    [playing]="playing()"
                    (guessChange)="guess.set($event)"
                    (lock)="lock()"
                    (toggle)="toggle()"
                  />
                } @else {
                  <p class="rt-locked"><span class="material-symbols-rounded" aria-hidden="true">lock</span> You said minute {{ locked() }}. The tape reveals it in the film room.</p>
                }
              } @else {
                <div class="rt-totals">
                  <div class="rt-splash-frame" aria-hidden="true">
                    @for (c of champions(); track c.seat + c.champion; let i = $index) {
                      <img class="rt-splash" [class.is-shown]="i === splashIndex()" [src]="ui.championArtUrl(c.champion)" (error)="ui.artFallback($event, c.champion)" alt="" />
                    }
                    @if (!motion.reduced()) {
                      @for (k of [splashIndex()]; track k) { <span class="rt-sheen"></span> }
                    }
                  </div>
                  @if (boardCall(); as call) {
                    <!-- A replay's one call, the board's own: the counts stay hidden until it is made, so the call is a call. -->
                    <div class="film-call rt-call" [class.is-done]="boardPicked() !== null">
                      <p class="film-call-q">{{ call.question }}</p>
                      <div class="film-chips" role="group" [attr.aria-label]="call.question">
                        @for (opt of call.options; track opt; let i = $index) {
                          <button type="button" class="film-chip" [style.--i]="i" [class.is-right]="boardPicked() !== null && i === call.answer" [class.is-wrong]="boardPicked() === i && i !== call.answer" [disabled]="boardPicked() !== null" [attr.aria-pressed]="boardPicked() === i" (click)="callBoard(i)">{{ opt }}</button>
                        }
                      </div>
                      @if (boardPicked() !== null) {
                        <p class="film-call-why">{{ boardPicked() === call.answer ? 'Called it. ' : '' }}{{ call.why }}.</p>
                      }
                    </div>
                  }
                  @if (chips().length && (!boardCall() || boardPicked() !== null)) {
                    <ul class="list-clean rt-chips" aria-label="Scoreline">
                      @for (s of chips(); track s.label; let i = $index) {
                        <li class="score-chip" [class.is-good]="s.good === true" [class.is-bad]="s.good === false" [style.--i]="i">
                          @if (s.ours) { <small>{{ s.label }}</small><b #num [attr.data-count]="s.ours"></b>@if (s.theirs) { <em>-<span #num [attr.data-count]="s.theirs"></span></em> } } @else { <b>{{ s.label }}</b> }
                        </li>
                      }
                    </ul>
                  }
                  <p class="rt-line">{{ replay() ? 'A replay carries totals only' : 'Fetching the minute-by-minute from Riot, then the coach writes' }}</p>
                </div>
              }
            </div>

            <aside class="rt-side">
              @if (champions().length) {
                <ul class="list-clean rt-champs" aria-label="Our five">
                  @for (c of champions(); track c.seat + c.champion; let i = $index) {
                    <li class="rt-champ" [style.--i]="i" [appTip]="c.champion + ' (' + c.seat + ')'">
                      <img class="rt-champ-img" [src]="ui.championIconUrl(c.champion)" [alt]="c.champion" loading="lazy" draggable="false" />
                    </li>
                  }
                </ul>
              }

              @if (phase() === 'error') {
                <div class="rt-callout" role="alert">
                  <span class="material-symbols-rounded" aria-hidden="true">error</span>
                  <span><b>The review did not come back.</b> {{ svc.error() }}</span>
                </div>
                <div class="rt-pills"><button type="button" class="view-btn" (click)="svc.close()">Close</button></div>
              } @else if (phase() === 'landed') {
                <p class="rt-landed-kicker"><span class="material-symbols-rounded" aria-hidden="true">check_circle</span> The review is in</p>
                <p class="rt-headline">
                  @for (w of headlineWords(); track 'h:' + $index) {
                    <span class="film-word" [style.--i]="$index">{{ w }}</span>{{ $last ? '' : ' ' }}
                  }
                </p>
                @if (timeline() && chips().length) {
                  <ul class="list-clean rt-chips is-landed" aria-label="Scoreline">
                    @for (s of chips(); track s.label; let i = $index) {
                      <li class="score-chip" [class.is-good]="s.good === true" [class.is-bad]="s.good === false" [style.--i]="i">
                        @if (s.ours) { <small>{{ s.label }}</small><b #num [attr.data-count]="s.ours"></b>@if (s.theirs) { <em>-<span #num [attr.data-count]="s.theirs"></span></em> } } @else { <b>{{ s.label }}</b> }
                      </li>
                    }
                  </ul>
                }
                <div class="rt-pills">
                  <button type="button" class="view-btn active" #openBtn (click)="openFilm()"><span class="material-symbols-rounded" aria-hidden="true">movie</span> Open the film room</button>
                  <button type="button" class="view-btn" (click)="svc.close()">Just the summary</button>
                </div>
              } @else {
                @if (timeline()) {
                  @if (motion.reduced()) {
                    @if (factLines().length) {
                      <ul class="list-clean rt-facts" aria-label="The facts">
                        @for (line of factLines(); track $index) { <li>{{ line }}</li> }
                      </ul>
                    }
                  } @else if (phase() === 'reel' && caption(); as cap) {
                    @for (c of [cap]; track c) { <p class="rt-caption">{{ c }}</p> }
                  }
                }
                @if (phase() === 'holding') {
                  @for (s of [status()]; track s) { <p class="rt-status">{{ s }}</p> }
                }
                @if (elapsed() >= stillWritingSec) {
                  <p class="rt-still">Still writing; Opus takes a minute or two on a long game.</p>
                }
              }

              @if (phase() !== 'error') {
                <div class="rt-elapsed">
                  <div class="rt-ring-wrap" [class.is-wrap]="elapsed() % 60 === 0">
                    <svg class="rt-ring" viewBox="0 0 40 40" aria-hidden="true">
                      <circle class="rt-ring-track" cx="20" cy="20" r="17" />
                      <circle class="rt-ring-fill" cx="20" cy="20" r="17" pathLength="100" [style.stroke-dashoffset]="ringOffset()" />
                    </svg>
                    <span class="rt-ring-n" aria-live="off">{{ elapsed() }}s</span>
                  </div>
                  <span class="rt-ring-label">{{ phase() === 'landed' ? 'elapsed, done' : 'elapsed, usually 30 to 90 s' }}</span>
                </div>
              }
            </aside>
          </div>
        </div>
  `
})
export class ReviewTakeoverStageComponent {
  /** The gate card's box at Roll it, for the stage to grow out of; null appears in place. */
  readonly flipFrom = input<DOMRect | null>(null);

  protected readonly svc = inject(ReviewTakeoverService);
  protected readonly motion = inject(MotionService);
  protected readonly ui = inject(UiService);
  private readonly data = inject(TeamDataService);
  private readonly timelines = inject(MatchTimelineService);
  private readonly prefs = inject(UserPrefsService);
  private readonly router = inject(Router);

  protected readonly stillWritingSec = STILL_WRITING_SEC;
  protected readonly phase = this.svc.phase;
  /** True from Roll it until the takeover closes: the one clock, the one ticker. */
  private readonly live = computed(() => this.phase() !== 'closed' && this.phase() !== 'gate');
  protected readonly matchId = computed(() => this.svc.matchId() ?? '');
  protected readonly game = computed(() => this.data.compAnalysis()?.games.find((g) => g.matchId === this.matchId()));
  protected readonly review = computed(() => this.data.reviewFor(this.matchId() || undefined));
  protected readonly replay = computed(() => {
    const g = this.game();
    return !!g && (g.timelineData === 'none' || g.laneData === 'none');
  });

  /** The timeline once read, held by match so the landing's forget-and-load never blanks the map. */
  private readonly held = signal<{ id: string; timeline: MatchTimeline } | null>(null);
  protected readonly timeline = computed(() => {
    const h = this.held();
    return h && h.id === this.matchId() ? h.timeline : null;
  });

  /** Our five in seat order: the game's players, else the review's, else the timeline's lanes. */
  protected readonly champions = computed<{ seat: Role; champion: string }[]>(() => {
    const order = (seat: Role) => ROLES.indexOf(seat);
    const fromGame = (this.game()?.players ?? [])
      .map((p) => ({ seat: POSITION_SEAT[p.position], champion: p.champion }))
      .filter((p): p is { seat: Role; champion: string } => !!p.seat && !!p.champion);
    const fromReview = (this.review()?.players ?? []).map((p) => ({ seat: p.seat, champion: p.champion }));
    const fromLanes = (this.timeline()?.lanes ?? []).map((l) => ({ seat: l.seat, champion: l.champion }));
    const list = fromGame.length ? fromGame : fromReview.length ? fromReview : fromLanes;
    return list.slice().sort((a, b) => order(a.seat) - order(b.seat));
  });

  private readonly players = computed<TapePlayer[]>(() => {
    const review = this.review();
    if (review) return review.players.map((p) => ({ seat: p.seat, name: p.name, champion: p.champion }));
    return (this.game()?.players ?? [])
      .map((p): TapePlayer | null => (POSITION_SEAT[p.position] ? { seat: POSITION_SEAT[p.position], name: p.name, champion: p.champion } : null))
      .filter((p): p is TapePlayer => p !== null);
  });

  protected readonly events = computed(() => {
    const tl = this.timeline();
    return tl ? tapeEventsOf(tl, this.players()) : [];
  });
  protected readonly chips = computed(() => scoreline(this.game()));
  protected readonly factLines = computed(() => this.timeline()?.facts?.lines ?? []);
  /** The board's call for a replay, off the game's totals; a Riot game waits for its timeline instead. */
  protected readonly boardCall = computed(() => (this.replay() ? boardCountsOf(this.game(), this.matchId()).call : null));
  private readonly boardPickedNow = signal<number | null>(null);
  /** The option picked, now or on an earlier visit: the same key the board chapter reads. */
  protected readonly boardPicked = computed<number | null>(() => {
    const now = this.boardPickedNow();
    if (now !== null) return now;
    const before = this.prefs.filmProgress(this.matchId())?.calls?.['board'];
    return before === undefined || before < 0 ? null : before;
  });

  private readonly clockRef = signal<FilmClock | null>(null);
  protected readonly t = computed(() => this.clockRef()?.t() ?? 0);
  protected readonly playing = computed(() => this.clockRef()?.playing() ?? false);
  protected readonly clock = computed(() => clockText(this.t()));
  protected readonly tally = computed(() => {
    const tl = this.timeline();
    return tl ? reelTallyOf(tl, this.t()) : null;
  });
  /** One of the facts' lines under the reel, walked with the clock: the first seven, in order. */
  protected readonly caption = computed(() => {
    const tl = this.timeline();
    const lines = this.factLines();
    if (!tl || !lines.length || tl.durationSec <= 0) return '';
    const n = Math.min(lines.length, MAX_CAPTIONS);
    return lines[Math.min(n - 1, Math.floor((this.t() / tl.durationSec) * n))] ?? '';
  });

  /** The reader's guess before Lock, in minutes; the minute locked this visit. */
  protected readonly guess = signal<number | null>(null);
  protected readonly locked = signal<number | null>(null);

  /** Real seconds since Roll it. */
  protected readonly elapsed = signal(0);
  private readonly holdAt = signal(0);
  protected readonly status = computed(() => STATUSES[Math.floor(Math.max(0, this.elapsed() - this.holdAt()) / STATUS_EVERY_SEC) % STATUSES.length]);
  protected readonly splashIndex = computed(() => {
    const n = this.champions().length;
    return n ? Math.floor(this.elapsed() / SPLASH_EVERY_SEC) % n : 0;
  });
  /** A seconds dial: the ring fills once a minute, and closes on the landing. */
  protected readonly ringOffset = computed(() => (this.phase() === 'landed' ? 0 : 100 - ((this.elapsed() % 60) / 60) * 100));

  protected readonly titleWords = computed(() => {
    switch (this.phase()) {
      case 'landed':
        return ['THE', 'REVIEW', 'IS', 'IN'];
      case 'error':
        return ['THE', 'REVIEW', 'FAILED'];
      default:
        return this.timeline() ? ['GENERATING', 'A', 'TIMELINE', 'OF', 'THE', 'GAME'] : ['READING', 'THE', 'GAME'];
    }
  });
  protected readonly titleKey = computed(() => `${this.phase() === 'landed' || this.phase() === 'error' ? this.phase() : 'reel'}:${this.timeline() ? 'tape' : 'totals'}`);
  protected readonly headlineWords = computed(() => {
    const team = this.review()?.team;
    const headline = team?.headline || (team?.summary ? firstSentence(team.summary) : '') || 'The review is on the row.';
    return headline.split(/\s+/).filter(Boolean);
  });
  protected readonly ariaLabel = computed(() => {
    switch (this.phase()) {
      case 'landed':
        return 'The review is in';
      case 'error':
        return 'The review failed';
      default:
        return 'Reviewing the game';
    }
  });

  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly openBtn = viewChild<ElementRef<HTMLButtonElement>>('openBtn');
  private readonly nums = viewChildren<ElementRef<HTMLElement>>('num');

  private flipped = false;
  private leaving = false;
  private countedKey = '';

  constructor() {
    // The timeline as soon as it is known, kept by match.
    effect(() => {
      const id = this.matchId();
      if (!id) return;
      const tl = this.timelines.known().get(id);
      if (tl) untracked(() => this.held.set({ id, timeline: tl }));
    });

    // One film clock per roll, once the timeline is there: the game in about forty-five seconds, or, with motion off, every mark at once.
    effect((onCleanup) => {
      const tl = this.timeline();
      if (!tl || !this.live()) return;
      const clock = createFilmClock({ durationSec: tl.durationSec, secPerGameMinute: (REEL_SEC * 60) / Math.max(60, tl.durationSec), onEnd: () => this.svc.hold() });
      untracked(() => {
        this.clockRef.set(clock);
        if (this.motion.reduced() || this.phase() !== 'reel') clock.seek(tl.durationSec);
        else clock.play();
      });
      onCleanup(() => {
        clock.destroy();
        this.clockRef.set(null);
      });
    });

    // The landing holds the map at the end; the totals reel with motion off holds at once.
    effect(() => {
      const phase = this.phase();
      untracked(() => {
        if (phase === 'landed') {
          const clock = this.clockRef();
          if (clock) {
            clock.pause();
            clock.seek(clock.durationSec);
          }
        }
        if (phase === 'holding') this.holdAt.set(this.elapsed());
        if (phase === 'reel' && !this.timeline() && this.motion.reduced()) this.svc.hold();
      });
    });

    // The ticker: elapsed seconds while the call runs; the totals reel's end; another read of a timeline still being fetched.
    effect((onCleanup) => {
      if (!this.live() || !this.svc.rolling()) return;
      const t0 = this.svc.t0();
      const tick = () => {
        const s = Math.max(0, Math.floor((Date.now() - t0) / 1000));
        this.elapsed.set(s);
        const id = this.matchId();
        if (!this.timeline()) {
          if (this.phase() === 'reel' && s >= REEL_SEC) this.svc.hold();
          if (s > 0 && s % TIMELINE_POLL_SEC === 0 && !this.replay() && this.timelines.known().get(id) === null) {
            this.timelines.forget(id);
            void this.timelines.load(id);
          }
        }
      };
      untracked(tick);
      const handle = setInterval(tick, 1000);
      onCleanup(() => clearInterval(handle));
    });

    // The stage grows out of the card, once, then takes focus.
    afterRenderEffect(() => {
      const stage = this.stage()?.nativeElement;
      if (!stage || this.flipped) return;
      this.flipped = true;
      const from = this.flipFrom();
      untracked(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (from && vw > 0 && vh > 0) {
          void this.motion.play(
            stage,
            [
              { transform: `translate(${from.left}px, ${from.top}px) scale(${from.width / vw}, ${from.height / vh})`, borderRadius: '14px' },
              { transform: 'none', borderRadius: '0px' }
            ],
            { duration: FLIP_MS, easing: FLIP_EASE }
          );
        }
        stage.focus({ preventScroll: true });
      });
    });

    // The landing's primary pill takes focus.
    afterRenderEffect(() => {
      const btn = this.openBtn()?.nativeElement;
      if (btn) untracked(() => btn.focus({ preventScroll: true }));
    });

    // The scoreline chips count up, once per set: the totals reel's, then the landing's.
    afterRenderEffect(() => {
      const els = this.nums();
      const key = `${this.phase() === 'landed' ? 'landed' : 'reel'}:${els.length}`;
      if (!els.length || this.countedKey === key) return;
      this.countedKey = key;
      untracked(() => {
        const still = this.motion.reduced();
        els.forEach((ref, i) => {
          const el = ref.nativeElement;
          const raw = el.dataset['count'] ?? '';
          const m = /^(\d+)(.*)$/.exec(raw);
          if (!m) {
            el.textContent = raw;
            return;
          }
          const to = Number(m[1]);
          const suffix = m[2];
          const format = (n: number) => `${Math.round(n)}${suffix}`;
          el.textContent = format(0);
          setTimeout(() => void this.motion.count(el, 0, to, 900, format), still ? 0 : i * 120);
        });
      });
    });

  }

  /** Escape on the stage: Close on a failure, Minimise otherwise. The host handles the gate. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    switch (this.phase()) {
      case 'closed':
      case 'gate':
        return;
      case 'error':
        this.svc.close();
        return;
      default:
        void this.minimise();
    }
  }

  /** Shrink back toward the Review button, then close; the call runs on. */
  protected async minimise(): Promise<void> {
    if (this.leaving) return;
    const stage = this.stage()?.nativeElement;
    const to = this.svc.fromEl?.isConnected ? this.svc.fromEl.getBoundingClientRect() : this.svc.fromRect();
    if (stage && to && !this.motion.reduced()) {
      this.leaving = true;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      await this.motion.play(
        stage,
        [
          { transform: 'none', opacity: 1 },
          { transform: `translate(${to.x}px, ${to.y}px) scale(${Math.max(0.01, to.width / vw)}, ${Math.max(0.01, to.height / vh)})`, opacity: 0 }
        ],
        { duration: SHRINK_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
      );
      this.leaving = false;
    }
    this.svc.minimise();
  }

  protected toggle(): void {
    this.clockRef()?.toggle();
  }

  /** Lock the guess: written to this person's film progress, so the tape opens on the reveal. */
  protected lock(): void {
    const minute = this.guess();
    const id = this.matchId();
    if (minute === null || !id || this.locked() !== null) return;
    this.locked.set(minute);
    const calls = { ...(this.prefs.filmProgress(id)?.calls ?? {}), turn: minute };
    void this.prefs.saveFilmProgress(id, { calls });
  }

  /** The replay's call: written under the board's own key, so the board chapter opens already answered. */
  protected callBoard(i: number): void {
    const id = this.matchId();
    if (!id || this.boardPicked() !== null) return;
    this.boardPickedNow.set(i);
    const calls = { ...(this.prefs.filmProgress(id)?.calls ?? {}), board: i };
    void this.prefs.saveFilmProgress(id, { calls });
  }

  protected async openFilm(): Promise<void> {
    const id = this.matchId();
    if (!id) return;
    this.svc.clearReady(id);
    await this.router.navigate(['/film', id], { queryParams: { fresh: 1 } });
    this.svc.close();
  }
}
