import { Component, computed, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { FilmMoment, FilmTapeCall } from '../../core/film-model';
import { MotionService } from '../../services/motion.service';
import { TooltipDirective } from '../tooltip.directive';

/** The curve's own length unit: the polyline carries pathLength=1000 so its dash offset is a permille of the game. */
const CURVE_LEN = 1000;
/** The minute ticks under the track, the ones the game reaches. */
const TICK_MINUTES = [5, 10, 15, 20, 25, 30, 35];
/** A guess this close to the answer counts as called. */
const CLOSE_MINUTES = 2;
/** The default voice's question, the one the takeover asks: it has no film yet. */
const DEFAULT_ASK = 'Where did it turn? Drag, then lock';

let uid = 0;

/** The second at a fraction of the track, snapped to whole seconds and kept inside the game. */
export function secAt(fraction: number, durationSec: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return Math.round(f * Math.max(0, durationSec));
}

/** The minute at a fraction of the track, snapped to whole minutes and kept inside the game. */
export function minuteAt(fraction: number, durationSec: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return Math.round(f * Math.max(0, durationSec) / 60);
}

/** The moment after (`dir` 1) or before (`dir` -1) a second; undefined when there is none that way. */
export function neighbourMoment(moments: readonly FilmMoment[], sec: number, dir: 1 | -1): FilmMoment | undefined {
  const sorted = [...moments].sort((a, b) => a.minute - b.minute);
  // A moment on the very second the hand stands on counts as "here", never as the next one.
  return dir > 0 ? sorted.find((m) => m.minute * 60 > sec + 0.5) : [...sorted].reverse().find((m) => m.minute * 60 < sec - 0.5);
}

/** "12:34" from a second. */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The film's one horizontal drag (9 Sep 2026): a track that is a bare minute
 * line while the reader still has to say where the game turned, and the
 * gold curve once that is revealed. Revealed, the curve is drawn only as far
 * as the second shown (the dash offset follows `t`, so scrub and play are
 * one path), moments sit on it as pins coloured by their swing, calls as
 * marks, and the reader's guess and the answer as labelled markers with a
 * dashed rule between them. Not revealed, a drag moves the guess and Lock
 * keeps it. Pointer capture and `touch-action: none` keep a phone's scroll
 * out of it; the keyboard walks a minute, Shift a moment, Space plays and
 * Enter locks. With motion off the curve stands whole and a native range
 * does the dragging, with the same outputs.
 */
@Component({
  selector: 'app-film-scrubber',
  imports: [TooltipDirective],
  host: { class: 'film-scrub', '[class.is-revealed]': 'revealed()', '[class.is-still]': 'motion.reduced()', '[class.is-playing]': 'playing()' },
  template: `
    <div class="film-scrub-side">
      <button type="button" class="view-btn film-scrub-play" [class.active]="!playing()" [attr.aria-label]="playing() ? 'Pause' : 'Play'" [appTip]="playing() ? 'Pause (Space)' : 'Play (Space)'" (click)="toggle.emit()">
        <span class="material-symbols-rounded" aria-hidden="true">{{ playing() ? 'pause' : 'play_arrow' }}</span>
      </button>
      <span class="film-scrub-clock" aria-live="off">{{ clock() }}</span>
    </div>

    <div class="film-scrub-main">
      @if (!revealed()) {
        <p class="film-scrub-ask" [attr.id]="'film-scrub-ask-' + id">{{ askShown() }}</p>
      }

      <div class="film-scrub-band">
      <div
        #track
        class="film-scrub-track"
        [class.is-dragging]="dragging()"
        role="slider"
        [tabindex]="motion.reduced() ? -1 : 0"
        [attr.aria-label]="revealed() ? 'Game time' : 'Where did it turn?'"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="revealed() ? durationSec() : durationMin()"
        [attr.aria-valuenow]="revealed() ? Math.round(t()) : (guess() ?? 0)"
        [attr.aria-valuetext]="revealed() ? clock() : (guess() === null ? 'No guess yet' : guess() + ' min')"
        [attr.aria-describedby]="revealed() ? null : 'film-scrub-ask-' + id"
        (pointerdown)="down($event)"
        (pointermove)="move($event)"
        (pointerup)="up($event)"
        (pointercancel)="up($event)"
        (keydown)="key($event)"
      >
        <svg class="film-scrub-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath [attr.id]="'film-scrub-up-' + id"><rect x="0" y="0" width="1000" height="50" /></clipPath>
            <clipPath [attr.id]="'film-scrub-down-' + id"><rect x="0" y="50" width="1000" height="50" /></clipPath>
          </defs>
          <line class="film-scrub-zero" x1="0" y1="50" x2="1000" y2="50" />
          @for (m of ticks(); track m) {
            <line class="film-scrub-tickline" [attr.x1]="x(m * 60)" y1="0" [attr.x2]="x(m * 60)" y2="100" />
          }
          @if (revealed() && curve(); as c) {
            <polyline class="film-scrub-curve is-up" [attr.points]="c" pathLength="1000" [attr.clip-path]="'url(#film-scrub-up-' + id + ')'" [style.stroke-dashoffset]="dashOffset()" />
            <polyline class="film-scrub-curve is-down" [attr.points]="c" pathLength="1000" [attr.clip-path]="'url(#film-scrub-down-' + id + ')'" [style.stroke-dashoffset]="dashOffset()" />
          }
        </svg>

        @for (m of ticks(); track m) {
          <span class="film-scrub-tick" [style.left.%]="pct(m * 60)" aria-hidden="true">{{ m }}</span>
        }

        @if (revealed()) {
          @if (rule(); as r) {
            <span class="film-scrub-rule" [class.is-close]="close()" [style.left.%]="r.from" [style.width.%]="r.width" aria-hidden="true"></span>
          }
          @if (guess() !== null) {
            <span class="film-scrub-mark is-guess" [class.is-close]="close()" [style.left.%]="pct(guess()! * 60)" [appTip]="'You said ' + guess() + ' min'"><i></i><small>You said {{ guess() }}</small></span>
          }
          @if (answer() !== null) {
            <span class="film-scrub-mark is-answer" [class.is-close]="close()" [style.left.%]="pct(answer()! * 60)" [appTip]="'It turned around ' + answer() + ' min'"><i></i><small>Turned {{ answer() }}</small></span>
          }
          <span class="film-scrub-hand" [style.--film-hand]="pct(t()) + '%'" aria-hidden="true"><i></i></span>
        } @else {
          @if (guess() !== null) {
            <span class="film-scrub-mark is-guess is-live" [style.left.%]="pct(guess()! * 60)"><i></i><small>{{ guess() }} min</small></span>
          } @else if (!motion.reduced()) {
            <span class="film-scrub-mark is-guess is-empty" [style.left.%]="50" aria-hidden="true"><i></i></span>
          }
        }
      </div>

      <!-- The moments and the calls sit over the track, not in it: a slider holds no buttons. A moment's tip says when, not what; the sheet reads it once the hand is there. -->
      @if (revealed()) {
        <div class="film-scrub-over">
          @for (c of calls(); track c.key) {
            <span class="film-scrub-call" [style.left.%]="pct(c.atSec)" [appTip]="'A call at ' + clockAt(c.atSec)" role="img" [attr.aria-label]="'A call at ' + clockAt(c.atSec)"></span>
          }
          @for (m of moments(); track m.minute + ':' + m.text) {
            <button type="button" [class]="'film-scrub-moment is-' + m.swing" [style.left.%]="pct(m.minute * 60)" [appTip]="momentTip(m)" [attr.aria-label]="momentTip(m)" (click)="seek.emit(m.minute * 60)"></button>
          }
        </div>
      }
      </div>

      @if (motion.reduced()) {
        <input
          type="range"
          class="film-scrub-range"
          [attr.aria-label]="revealed() ? 'Game time, in seconds' : 'Where did it turn, in minutes'"
          min="0"
          [max]="revealed() ? durationSec() : durationMin()"
          step="1"
          [value]="revealed() ? Math.round(t()) : (guess() ?? 0)"
          (input)="range($event)"
        />
      }

      @if (verdict(); as v) {
        <p class="film-scrub-verdict" [class.is-close]="close()">{{ v }}</p>
      }
    </div>

    @if (!revealed()) {
      <button type="button" class="view-btn active film-scrub-lock" [disabled]="guess() === null" (click)="lock.emit()">
        <span class="material-symbols-rounded" aria-hidden="true">lock</span> {{ lockLabel() }}
      </button>
    }
  `
})
export class FilmScrubberComponent {
  readonly durationSec = input<number>(0);
  /** Index is the minute; ours minus theirs. */
  readonly goldDiff = input<number[]>([]);
  /** The second shown. */
  readonly t = input<number>(0);
  readonly moments = input<FilmMoment[]>([]);
  /** False until the reader has locked a guess: the curve, the moments and the calls stay hidden. */
  readonly revealed = input<boolean>(false);
  /** The minute the reader placed. */
  readonly guess = input<number | null>(null);
  /** The minute it turned. */
  readonly answer = input<number | null>(null);
  readonly calls = input<FilmTapeCall[]>([]);
  readonly playing = input<boolean>(false);
  /** The question over the track before the reveal; the film's voice sets it, the takeover keeps the default. "Drag" reads "Slide" with motion off. */
  readonly ask = input<string>(DEFAULT_ASK);
  /** The Lock pill's word, from the film's voice. */
  readonly lockLabel = input<string>('Lock');

  /** A second to move the hand to. */
  readonly seek = output<number>();
  /** The guess moved, in whole minutes. */
  readonly guessChange = output<number>();
  readonly lock = output<void>();
  /** Play or pause. */
  readonly toggle = output<void>();

  protected readonly motion = inject(MotionService);
  protected readonly Math = Math;
  protected readonly id = ++uid;
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  protected readonly dragging = signal(false);
  private pointerId: number | null = null;

  protected readonly askShown = computed(() => (this.motion.reduced() ? this.ask().replace('Drag', 'Slide') : this.ask()));
  protected readonly durationMin = computed(() => Math.max(1, Math.round(this.durationSec() / 60)));
  protected readonly clock = computed(() => clockText(this.t()));
  protected readonly ticks = computed(() => TICK_MINUTES.filter((m) => m * 60 <= this.durationSec()));

  /** The polyline's points in the 1000 by 100 box: minute m at x(m), zero at 50, the largest swing at the edge. */
  protected readonly curve = computed(() => {
    const g = this.goldDiff();
    if (g.length < 2 || this.durationSec() <= 0) return '';
    const max = Math.max(1000, ...g.map((v) => Math.abs(v)));
    return g.map((v, m) => `${this.x(m * 60).toFixed(1)},${(50 - (v / max) * 46).toFixed(1)}`).join(' ');
  });

  /** How much of the curve is hidden past the second shown; none with motion off, so the curve stands whole. */
  protected readonly dashOffset = computed(() => {
    if (this.motion.reduced()) return 0;
    const d = this.durationSec();
    if (d <= 0) return CURVE_LEN;
    return Math.round(Math.min(CURVE_LEN, Math.max(0, CURVE_LEN - (CURVE_LEN * this.t()) / d)));
  });

  protected readonly close = computed(() => {
    const g = this.guess();
    const a = this.answer();
    return g !== null && a !== null && Math.abs(g - a) <= CLOSE_MINUTES;
  });

  /** The dashed rule between the guess and the answer, as a left and a width in percent. */
  protected readonly rule = computed(() => {
    const g = this.guess();
    const a = this.answer();
    if (g === null || a === null || g === a) return null;
    const from = this.pct(Math.min(g, a) * 60);
    const to = this.pct(Math.max(g, a) * 60);
    return { from, width: to - from };
  });

  protected readonly verdict = computed(() => {
    if (!this.revealed()) return '';
    const g = this.guess();
    const a = this.answer();
    if (a === null) return g === null ? '' : `You said ${g}`;
    if (g === null) return `It turned around ${a}`;
    if (g === a) return `You said ${g}, and that is when it turned`;
    return `You said ${g}, it turned around ${a}`;
  });

  /** A second as a percent of the track. */
  protected pct(sec: number): number {
    const d = this.durationSec();
    if (d <= 0) return 0;
    return Math.min(100, Math.max(0, (sec / d) * 100));
  }

  /** A second in the curve's own x space. */
  protected x(sec: number): number {
    return (this.pct(sec) * CURVE_LEN) / 100;
  }

  protected clockAt(sec: number): string {
    return clockText(sec);
  }

  /** When a moment is and which way it went; never its sentence, which could give a call away before its reveal. */
  protected momentTip(m: FilmMoment): string {
    const way = m.swing === 'us' ? 'our way' : m.swing === 'them' ? 'their way' : 'even';
    return `A moment at ${m.minute} min, ${way}`;
  }

  private fraction(ev: PointerEvent): number {
    const el = this.track()?.nativeElement;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? (ev.clientX - r.left) / r.width : 0;
  }

  private emitAt(fraction: number): void {
    if (this.revealed()) this.seek.emit(secAt(fraction, this.durationSec()));
    else this.guessChange.emit(minuteAt(fraction, this.durationSec()));
  }

  protected down(ev: PointerEvent): void {
    if (this.motion.reduced() || ev.button !== 0) return;
    const el = this.track()?.nativeElement;
    if (!el) return;
    this.pointerId = ev.pointerId;
    try {
      el.setPointerCapture(ev.pointerId);
    } catch {
      /* a synthetic event without capture support: the drag still follows the moves that reach the track */
    }
    this.dragging.set(true);
    el.focus({ preventScroll: true });
    ev.preventDefault();
    this.emitAt(this.fraction(ev));
  }

  protected move(ev: PointerEvent): void {
    if (!this.dragging() || ev.pointerId !== this.pointerId) return;
    ev.preventDefault();
    this.emitAt(this.fraction(ev));
  }

  protected up(ev: PointerEvent): void {
    if (ev.pointerId !== this.pointerId) return;
    const el = this.track()?.nativeElement;
    try {
      el?.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
    this.pointerId = null;
    this.dragging.set(false);
  }

  protected key(ev: KeyboardEvent): void {
    const d = this.durationSec();
    switch (ev.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir: 1 | -1 = ev.key === 'ArrowRight' ? 1 : -1;
        ev.preventDefault();
        if (this.revealed()) {
          if (ev.shiftKey) {
            const m = neighbourMoment(this.moments(), this.t(), dir);
            if (m) this.seek.emit(m.minute * 60);
            else this.seek.emit(dir > 0 ? d : 0);
          } else {
            this.seek.emit(Math.min(d, Math.max(0, Math.round(this.t()) + 60 * dir)));
          }
        } else {
          const cur = this.guess() ?? Math.round(this.durationMin() / 2);
          this.guessChange.emit(Math.min(this.durationMin(), Math.max(0, cur + dir)));
        }
        return;
      }
      case 'Home':
        ev.preventDefault();
        if (this.revealed()) this.seek.emit(0);
        else this.guessChange.emit(0);
        return;
      case 'End':
        ev.preventDefault();
        if (this.revealed()) this.seek.emit(d);
        else this.guessChange.emit(this.durationMin());
        return;
      case ' ':
      case 'Spacebar':
        ev.preventDefault();
        this.toggle.emit();
        return;
      case 'Enter':
        if (!this.revealed() && this.guess() !== null) {
          ev.preventDefault();
          this.lock.emit();
        }
        return;
    }
  }

  /** The native range with motion off: the same outputs as the drag. */
  protected range(ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    if (this.revealed()) this.seek.emit(Math.round(v));
    else this.guessChange.emit(Math.round(v));
  }
}
