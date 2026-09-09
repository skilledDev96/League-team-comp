import { Location } from '@angular/common';
import { Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { createFilmClock, FilmClock } from '../../../core/film-clock';
import { FilmModel, FilmMoment, FilmTapeCall } from '../../../core/film-model';
import { MotionService } from '../../../services/motion.service';
import { ToastService } from '../../../services/toast.service';
import { clockText, FilmScrubberComponent, neighbourMoment } from '../../../shared/film/film-scrubber.component';
import { RiftMapComponent, RiftToken } from '../../../shared/film/rift-map.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';

/** Real seconds per game minute: a 30-minute game plays in 36 s. */
const RATE = 1.2;
/** How long the curve takes to draw on the reveal, before the tempo. */
const DRAW_MS = 1200;
/** A guess this close to the answer counts as called; the scrubber uses the same number. */
const CLOSE_MINUTES = 2;

/** A request from the page to move the hand: `n` makes a second request to the same second distinct. */
export interface FilmSeekRequest {
  sec: number;
  n: number;
  /** Play on from there; the page asks for it off the map's Watch it. */
  play?: boolean;
}

/** Why the hand is standing still with something in the sheet. */
type TapeStop =
  | { kind: 'moment'; sec: number; moment: FilmMoment }
  | { kind: 'call'; sec: number; call: FilmTapeCall }
  | { kind: 'token'; sec: number; label: string; line?: string };

/**
 * The tape (9 Sep 2026): the Rift with the game dropping onto it second by
 * second, over the scrubber whose track becomes the gold curve. Nothing
 * shows on the curve until the reader has said where the game turned and
 * locked it: then the curve draws to the hand, the answer marker lands with
 * the tape's line on it, and the clock takes over. The hand pauses on each
 * moment with its sentence and what the gold did next, and a game-minute
 * before each objective or fight with a call; the reveal is the tokens
 * dropping at their second. Tapping a token pauses on its label, and a
 * death of ours brings its ledger line with it. Copy link carries the
 * second. Only the chapter on stage runs its clock. With motion off the
 * curve stands whole after Lock, the scrubber is a native range, Prev and
 * Next moment pills do the walking, and nothing plays on its own.
 */
@Component({
  selector: 'app-film-tape',
  imports: [TooltipDirective, FilmFrameComponent, RiftMapComponent, FilmScrubberComponent],
  template: `
    @let tape = model().tape;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (tape) {
        <div class="film-tape" [class.is-revealed]="revealed()">
          <div class="film-tape-map">
            <app-rift-map [events]="tape.events" [until]="t()" [showCurveHint]="!revealed()" (tap)="onTap($event)" />
          </div>

          <aside class="film-tape-sheet" aria-live="polite">
            @if (!revealed()) {
              <p class="film-tape-sheet-kicker">Before the curve</p>
              <p class="film-tape-sheet-text">Drag the marker to the minute you think this game turned, then lock it. The gold curve shows once you have.</p>
              <p class="film-tape-sheet-hint">Play runs the map without the curve, if you want a look first.</p>
            } @else if (stop(); as s) {
              @switch (s.kind) {
                @case ('moment') {
                  <p class="film-tape-sheet-kicker" [class.is-ok]="s.moment.swing === 'us'" [class.is-warn]="s.moment.swing === 'them'">
                    <span class="film-tape-min">{{ s.moment.minute }} min</span> {{ s.moment.swing === 'us' ? 'Our way' : s.moment.swing === 'them' ? 'Their way' : 'Even' }}
                  </p>
                  <p class="film-tape-sheet-text">{{ s.moment.text }}</p>
                  @if (s.moment.consequence) { <p class="film-tape-sheet-line">{{ s.moment.consequence }}</p> }
                  <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> Continue</button>
                }
                @case ('call') {
                  <p class="film-tape-sheet-kicker">Call it, <span class="film-tape-min">{{ minuteOf(s.call.revealSec) }} min</span></p>
                  <p class="film-call-q film-tape-sheet-q">{{ s.call.question }}</p>
                  <div class="film-chips" role="group" [attr.aria-label]="s.call.question">
                    @for (opt of s.call.options; track opt; let i = $index) {
                      <button type="button" class="film-chip" [style.--i]="i" (click)="choose(s.call, i)">{{ opt }}</button>
                    }
                  </div>
                  <button type="button" class="view-btn film-skip" (click)="skipCall(s.call)">Skip the call</button>
                }
                @case ('token') {
                  <p class="film-tape-sheet-kicker"><span class="film-tape-min">{{ clockAt(s.sec) }}</span></p>
                  <p class="film-tape-sheet-text">{{ s.label }}</p>
                  @if (s.line) { <p class="film-tape-sheet-line">{{ s.line }}</p> }
                  <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> Continue</button>
                }
              }
            } @else if (outcome(); as o) {
              <p class="film-tape-sheet-kicker" [class.is-ok]="o.right" [class.is-warn]="!o.right">{{ o.right ? 'Called it' : 'Not this time' }}</p>
              <p class="film-tape-sheet-text">{{ o.call.why }}</p>
              <p class="film-tape-sheet-hint">Watch it land at {{ clockAt(o.call.revealSec) }}.</p>
            } @else {
              <p class="film-tape-sheet-kicker" [class.is-ok]="close()">{{ close() ? 'Called it' : 'Where it turned' }}</p>
              @if (tape.turn; as turn) {
                <p class="film-tape-sheet-text">{{ turn.why }}</p>
              } @else {
                <p class="film-tape-sheet-text">The curve never settled on one turning point; the review reads the moments instead.</p>
              }
              @if (verdict(); as v) { <p class="film-tape-sheet-line" [class.is-ok]="close()">{{ v }}</p> }
              @if (!motion.reduced()) {
                <p class="film-tape-sheet-hint">Space plays, arrows step a minute, Shift with an arrow jumps to a moment.</p>
              }
            }

            @if (motion.reduced() && revealed()) {
              <div class="film-tape-steps">
                <button type="button" class="view-btn" [disabled]="!prevMoment()" (click)="jump(-1)"><span class="material-symbols-rounded" aria-hidden="true">skip_previous</span> Previous moment</button>
                <button type="button" class="view-btn" [disabled]="!nextMoment()" (click)="jump(1)">Next moment <span class="material-symbols-rounded" aria-hidden="true">skip_next</span></button>
              </div>
            }
          </aside>

          <div class="film-tape-scrub">
            <app-film-scrubber
              [durationSec]="tape.durationSec"
              [goldDiff]="tape.goldDiff"
              [t]="shownT()"
              [moments]="tape.moments"
              [revealed]="revealed()"
              [guess]="guessShown()"
              [answer]="tape.turn?.minute ?? null"
              [calls]="tape.calls"
              [playing]="playing()"
              (seek)="seek($event)"
              (guessChange)="dragging.set($event)"
              (lock)="lock()"
              (toggle)="toggle()"
            />
            <div class="film-tape-tools">
              <button type="button" class="view-btn" [appTip]="'Copy a link to this second of the tape'" (click)="copyLink()"><span class="material-symbols-rounded" aria-hidden="true">link</span> Copy link</button>
            </div>
          </div>
        </div>
      } @else {
        <p class="film-wait">No timeline read for this game, so there is no tape.</p>
      }
    </app-film-frame>
  `
})
export class FilmTapeComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The tape');
  readonly index = input<number>(1);
  readonly count = input<number>(1);
  /** True while this is the chapter on screen: the clock runs only then. */
  readonly active = input<boolean>(false);
  /** The minute the reader said it turned, from their progress (calls['turn']); undefined until they lock one. */
  readonly guess = input<number | undefined>(undefined);
  /** Every call made in the film, so a tape call once answered is not asked twice. */
  readonly calls = input<Record<string, number> | undefined>(undefined);
  /** The second the link opened on (?t=), seeked to once when the clock is made. */
  readonly initialSec = input<number | null>(null);
  /** The page asks for a second, off the map's Watch it. */
  readonly seekTo = input<FilmSeekRequest | null>(null);
  readonly answered = output<{ key: string; choice: number }>();
  /** Copy link was pressed: the second copied, so the page can put it in the url. */
  readonly copied = output<number>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly motion = inject(MotionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  private readonly clock = signal<FilmClock | null>(null);
  protected readonly t = computed(() => this.clock()?.t() ?? 0);
  protected readonly playing = computed(() => this.clock()?.playing() ?? false);
  /** The guess while it is being dragged, before Lock. */
  protected readonly dragging = signal<number | null>(null);
  /** The minute locked this visit, until the progress carries it. */
  private readonly locked = signal<number | null>(null);
  protected readonly guessShown = computed<number | null>(() => this.guess() ?? this.locked() ?? this.dragging());
  /** A guess locked, here or in the takeover; or a link to a second, which shows the moment without a verdict. */
  protected readonly revealed = computed(() => this.guess() !== undefined || this.locked() !== null || this.initialSec() !== null);
  /** The curve's draw on the reveal: the second drawn to so far, or null once it is drawn and the clock's own second stands. */
  private readonly drawT = signal<number | null>(null);
  protected readonly shownT = computed(() => this.drawT() ?? this.t());
  protected readonly stop = signal<TapeStop | null>(null);
  /** The last call's result, shown until the next stop or a seek. */
  protected readonly outcome = signal<{ call: FilmTapeCall; right: boolean } | null>(null);
  /** Calls skipped this visit: the hand does not stop for them again. */
  private readonly skipped = signal<ReadonlySet<string>>(new Set());
  private lastT = -1;
  private drawn = false;
  private drawFrame: number | null = null;
  private seekHandled = 0;
  /** Watch it asked for play while the chapter was still off stage: play once it is on. */
  private playWhenActive = false;

  /** What the clock is keyed on: the game and its length. A rebuilt model (another review landing) keeps the clock and its second. */
  private readonly clockKey = computed(() => {
    const m = this.model();
    return m.tape ? `${m.matchId}:${m.tape.durationSec}` : null;
  });

  protected readonly close = computed(() => {
    const g = this.guessShown();
    const a = this.model().tape?.turn?.minute ?? null;
    return this.revealed() && g !== null && a !== null && Math.abs(g - a) <= CLOSE_MINUTES;
  });
  protected readonly verdict = computed(() => {
    const g = this.guessShown();
    const a = this.model().tape?.turn?.minute ?? null;
    if (g === null || a === null) return '';
    return g === a ? `You said ${g}, and that is when it turned` : `You said ${g}, it turned around ${a}`;
  });
  protected readonly prevMoment = computed(() => neighbourMoment(this.model().tape?.moments ?? [], this.t(), -1));
  protected readonly nextMoment = computed(() => neighbourMoment(this.model().tape?.moments ?? [], this.t(), 1));

  constructor() {
    // One clock per game, keyed on the match and its length, never on the model's identity; the link's second is the first thing it shows.
    effect((onCleanup) => {
      const key = this.clockKey();
      if (!key) return;
      const durationSec = Number(key.slice(key.lastIndexOf(':') + 1));
      const clock = createFilmClock({ durationSec, secPerGameMinute: RATE });
      untracked(() => {
        const init = this.initialSec();
        if (init !== null && Number.isFinite(init)) clock.seek(init);
        this.lastT = clock.t();
        this.clock.set(clock);
      });
      onCleanup(() => clock.destroy());
    });

    // Only the chapter on stage runs; a Watch it that arrived off stage plays once it is on.
    effect(() => {
      const active = this.active();
      untracked(() => {
        const clock = this.clock();
        if (!active) {
          clock?.pause();
          return;
        }
        if (this.playWhenActive && clock) {
          this.playWhenActive = false;
          if (!this.motion.reduced()) clock.play();
        }
      });
    });

    // The reveal: once there is a guess and the chapter is up, the curve draws to the hand.
    effect(() => {
      const clock = this.clock();
      if (!clock || !this.active() || !this.revealed() || this.drawn) return;
      this.drawn = true;
      untracked(() => this.reveal(clock));
    });

    // The hand pauses on a moment or a call it has just crossed.
    effect(() => {
      const t = this.t();
      const clock = this.clock();
      untracked(() => {
        if (!clock) return;
        const prev = this.lastT;
        this.lastT = t;
        if (!clock.playing() || t <= prev) return;
        const stop = this.nextStop(prev, t);
        if (!stop) return;
        clock.pause();
        clock.seek(stop.sec);
        this.lastT = stop.sec;
        this.outcome.set(null);
        this.stop.set(stop);
      });
    });

    // The page asks for a second: the map's Watch it, twenty seconds before the death.
    effect(() => {
      const req = this.seekTo();
      const clock = this.clock();
      if (!req || !clock || req.n === this.seekHandled) return;
      this.seekHandled = req.n;
      untracked(() => {
        this.seek(req.sec);
        if (!req.play || this.motion.reduced()) return;
        // The page is still fading the map out when this lands: only the chapter on stage plays.
        if (this.active()) clock.play();
        else this.playWhenActive = true;
      });
    });

    this.destroyRef.onDestroy(() => this.cancelDraw());
  }

  /** Where the hand stands on the reveal: the link's second when there is one, else the turning point, else the end so the whole curve shows. */
  private reveal(clock: FilmClock): void {
    const tape = this.model().tape;
    if (!tape) return;
    if (this.initialSec() === null && clock.t() === 0) {
      clock.seek(tape.turn ? tape.turn.minute * 60 : tape.durationSec);
      this.lastT = clock.t();
    }
    const target = clock.t();
    if (this.motion.reduced() || target <= 0 || typeof requestAnimationFrame !== 'function') return;
    const ms = DRAW_MS * this.motion.tempo(this.host.nativeElement);
    const start = performance.now();
    this.drawT.set(0);
    const step = (now: number) => {
      const f = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - f, 3);
      if (f < 1) {
        this.drawT.set(target * eased);
        this.drawFrame = requestAnimationFrame(step);
      } else {
        this.drawFrame = null;
        this.drawT.set(null);
        if (this.active() && clock.t() < clock.durationSec) clock.play();
      }
    };
    this.drawFrame = requestAnimationFrame(step);
  }

  private cancelDraw(): void {
    if (this.drawFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.drawFrame);
    this.drawFrame = null;
    this.drawT.set(null);
  }

  /** The earliest moment or open call the hand crossed between two seconds; moments only once the curve is revealed. */
  private nextStop(prev: number, t: number): TapeStop | null {
    const tape = this.model().tape;
    if (!tape) return null;
    const answered = this.calls() ?? {};
    const skipped = this.skipped();
    const stops: TapeStop[] = tape.calls.filter((c) => answered[c.key] === undefined && !skipped.has(c.key)).map((c) => ({ kind: 'call', sec: c.atSec, call: c }));
    if (this.revealed()) {
      for (const m of tape.moments) stops.push({ kind: 'moment', sec: m.minute * 60, moment: m });
    }
    return stops.filter((s) => s.sec > prev && s.sec <= t).sort((a, b) => a.sec - b.sec)[0] ?? null;
  }

  protected seek(sec: number): void {
    const clock = this.clock();
    if (!clock) return;
    this.cancelDraw();
    clock.seek(sec);
    this.lastT = clock.t();
    this.stop.set(null);
    this.outcome.set(null);
  }

  protected toggle(): void {
    const clock = this.clock();
    if (!clock) return;
    if (clock.playing()) {
      clock.pause();
      return;
    }
    this.stop.set(null);
    clock.play();
  }

  /** Continue after a pause: the hand moves on from where it stands. */
  protected resume(): void {
    this.stop.set(null);
    if (!this.motion.reduced()) this.clock()?.play();
  }

  /** Prev or Next moment with motion off: the hand lands on it and the sheet reads it. */
  protected jump(dir: 1 | -1): void {
    const m = dir > 0 ? this.nextMoment() : this.prevMoment();
    if (!m) return;
    this.seek(m.minute * 60);
    this.stop.set({ kind: 'moment', sec: m.minute * 60, moment: m });
  }

  protected lock(): void {
    const minute = this.dragging();
    if (minute === null || this.revealed()) return;
    this.locked.set(minute);
    this.answered.emit({ key: 'turn', choice: minute });
  }

  protected choose(call: FilmTapeCall, i: number): void {
    this.answered.emit({ key: call.key, choice: i });
    this.outcome.set({ call, right: i === call.answer });
    this.stop.set(null);
    if (!this.motion.reduced()) this.clock()?.play();
  }

  protected skipCall(call: FilmTapeCall): void {
    this.skipped.set(new Set([...this.skipped(), call.key]));
    this.stop.set(null);
    if (!this.motion.reduced()) this.clock()?.play();
  }

  /** A token tapped: the hand pauses on its label, and a death of ours brings its ledger line. */
  protected onTap(tok: RiftToken): void {
    this.clock()?.pause();
    const line = tok.pinKey ? this.model().map?.pins.find((p) => p.key === tok.pinKey)?.line : undefined;
    this.outcome.set(null);
    this.stop.set({ kind: 'token', sec: tok.sec, label: tok.label, line: line || undefined });
  }

  @HostListener('window:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (!this.active() || !this.clock()) return;
    const target = event.target as HTMLElement | null;
    // The scrubber's track and any control handle their own keys.
    if (target && (target.closest('.film-scrub-track') || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName) || target.isContentEditable)) return;
    switch (event.key) {
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        this.toggle();
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir: 1 | -1 = event.key === 'ArrowRight' ? 1 : -1;
        event.preventDefault();
        if (event.shiftKey && this.revealed()) {
          const m = neighbourMoment(this.model().tape?.moments ?? [], this.t(), dir);
          this.seek(m ? m.minute * 60 : dir > 0 ? this.clock()!.durationSec : 0);
        } else {
          this.seek(Math.round(this.t()) + 60 * dir);
        }
        return;
      }
    }
  }

  protected async copyLink(): Promise<void> {
    const sec = Math.round(this.t());
    const url = this.router.serializeUrl(this.router.createUrlTree(['/film', this.model().matchId], { queryParams: { c: 'tape', t: sec } }));
    const link = `${window.location.origin}${this.location.prepareExternalUrl(url)}`;
    try {
      await navigator.clipboard.writeText(link);
      this.toast.show('Link copied', { kind: 'ok', icon: 'link', text: `It opens the tape at ${clockText(sec)}.` });
      this.copied.emit(sec);
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'The browser refused the clipboard; copy the address bar instead.' });
    }
  }

  protected minuteOf(sec: number): number {
    return Math.round(sec / 60);
  }

  protected clockAt(sec: number): string {
    return clockText(sec);
  }
}
