import { Location } from '@angular/common';
import { afterRenderEffect, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { createFilmClock, FilmClock } from '../../../core/film-clock';
import { FilmBeat, FilmModel } from '../../../core/film-model';
import { voiceOf } from '../../../core/film-style';
import { Role } from '../../../models/team.models';
import { MotionService } from '../../../services/motion.service';
import { ToastService } from '../../../services/toast.service';
import { UiService } from '../../../services/ui.service';
import { FilmGlyphComponent } from '../../../shared/film/film-glyph.component';
import { clockText, FilmScrubberComponent } from '../../../shared/film/film-scrubber.component';
import { RiftMapComponent, RiftToken } from '../../../shared/film/rift-map.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';

/** Real seconds per game minute before the film's own rate: a 30-minute game plays in 36 s at 1, 31 s at 0.85, 45 s at 1.25. */
const RATE = 1.2;
/** How long the curve takes to draw when the chapter comes up, before the tempo. */
const DRAW_MS = 1200;
/** A guess this close to the answer counts as called; the scrubber uses the same number. */
const CLOSE_MINUTES = 2;
/** A beat's card holds the tape for at least this long, at most that, and otherwise as long as its words take to read at 280 ms each; then the tempo. */
const DWELL_MIN_MS = 3500;
const DWELL_MAX_MS = 8000;
const DWELL_PER_WORD_MS = 280;
/** The hand within this many seconds of a beat lights its chip on the rail. */
const BEAT_NEAR_SEC = 30;

/** A request from the page to move the hand: `n` makes a second request to the same second distinct. */
export interface FilmSeekRequest {
  sec: number;
  n: number;
  /** Play on from there; the page asks for it off the map's Watch it. */
  play?: boolean;
}

/** Why the hand is standing still with something in the sheet. */
type TapeStop = { kind: 'beat'; sec: number; beat: FilmBeat } | { kind: 'token'; sec: number; label: string; line?: string };

/** The beat after (`dir` 1) or before (`dir` -1) a second; undefined when there is none that way. A beat on the very second the hand stands on is "here", never the next one. */
export function neighbourBeat(beats: readonly FilmBeat[], sec: number, dir: 1 | -1): FilmBeat | undefined {
  const sorted = [...beats].sort((a, b) => a.sec - b.sec);
  return dir > 0 ? sorted.find((b) => b.sec > sec + 0.5) : [...sorted].reverse().find((b) => b.sec < sec - 0.5);
}

/** How long a beat's card stays before the tape plays on, before the tempo. */
export function dwellMsFor(text: string): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, words * DWELL_PER_WORD_MS));
}

/**
 * The tape (9 Sep 2026; cut 4 on 10 Sep 2026): the Rift with the game
 * dropping onto it second by second, over the scrubber whose track is the
 * gold curve. The tape narrates now instead of asking: the curve stands as
 * soon as the chapter has a clock and draws itself to the turn once when the
 * chapter comes up, the sheet opens on where it turned (with the reader's
 * takeover guess under it when they made one), and the hand stops on each
 * beat the build picked out (the coach's moments, the objectives, the
 * fights, the firsts, the turn, the costliest avoidable deaths) with a card
 * that says what it was, whose it was, who it was about and what the gold
 * did next. A beat holds for a dwell measured off its words, shown as a bar
 * running down, then the tape plays on by itself; Pause holds the card,
 * the voice's Continue skips the dwell. A rail of the beats under the sheet
 * jumps to any of them without playing. Tapping a token pauses on its label,
 * and a death of ours brings the film's read of it. Copy link carries the
 * second. Only the chapter on stage runs its clock. With motion off nothing
 * plays on its own: the curve stands whole, the scrubber is a native range
 * and Prev and Next beat pills do the walking.
 */
@Component({
  selector: 'app-film-tape',
  imports: [TooltipDirective, FilmFrameComponent, RiftMapComponent, FilmScrubberComponent, FilmGlyphComponent],
  template: `
    @let tape = model().tape;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (tape) {
        <div class="film-tape" [class.is-revealed]="revealed()">
          <div class="film-tape-map">
            <app-rift-map [events]="tape.events" [until]="t()" [highlightSeats]="litSeats()" [highlightSec]="litSec()" (tap)="onTap($event)" />
          </div>

          <div class="film-tape-side">
            <aside class="film-tape-sheet" aria-live="polite">
              @if (stop(); as s) {
                @switch (s.kind) {
                  @case ('beat') {
                    <article class="film-beat" [attr.data-kind]="s.beat.kind">
                      <span class="film-beat-glyph" [class.is-ok]="s.beat.swing === 'us'" [class.is-warn]="s.beat.swing === 'them'"><app-film-glyph [name]="s.beat.glyph" [size]="1.6" /></span>
                      <p class="film-tape-sheet-kicker film-beat-kicker" [class.is-ok]="s.beat.swing === 'us'" [class.is-warn]="s.beat.swing === 'them'">
                        <span class="film-tape-min">{{ clockAt(s.beat.sec) }}</span> {{ swingWord(s.beat) }}
                      </p>
                      <!-- A coach's moment is titled by its swing, which the kicker has just said; the title line stands only when it adds a word. -->
                      @if (s.beat.title !== swingWord(s.beat)) { <p class="film-beat-title">{{ s.beat.title }}</p> }
                      <p class="film-tape-sheet-text film-beat-text">{{ s.beat.text }}</p>
                      @if (tiles(s.beat).length) {
                        <div class="film-beat-tiles" aria-label="Who it was about">
                          @for (tile of tiles(s.beat); track tile.champion) {
                            <span class="film-beat-tile" [style.--i]="$index" [appTip]="tile.seat ? tile.seat + ' · ' + tile.champion : tile.champion">
                              <img [src]="ui.championIconUrl(tile.champion)" [alt]="tile.champion" loading="lazy" />
                              @if (tile.seat) { <small>{{ tile.seat }}</small> }
                            </span>
                          }
                        </div>
                      }
                      @if (s.beat.consequence) { <p class="film-tape-sheet-line film-beat-consequence">{{ s.beat.consequence }}</p> }
                      @if (dwell(); as d) {
                        <span #dwellBar class="film-beat-dwell" [style.--dwell]="d.ms + 'ms'" role="progressbar" aria-label="Playing on shortly" [attr.aria-valuetext]="'Plays on in about ' + Math.round(d.ms / 1000) + ' seconds'"></span>
                      }
                      <div class="film-beat-actions">
                        @if (dwell()) {
                          <button type="button" class="view-btn active" (click)="hold()"><span class="material-symbols-rounded" aria-hidden="true">pause</span> Pause</button>
                          <button type="button" class="view-btn" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">skip_next</span> {{ voice().momentContinue }}</button>
                        } @else if (held()) {
                          <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> Play on</button>
                        } @else {
                          <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> {{ voice().momentContinue }}</button>
                        }
                      </div>
                    </article>
                  }
                  @case ('token') {
                    <p class="film-tape-sheet-kicker"><span class="film-tape-min">{{ clockAt(s.sec) }}</span></p>
                    <p class="film-tape-sheet-text">{{ s.label }}</p>
                    @if (s.line) { <p class="film-tape-sheet-line">{{ s.line }}</p> }
                    <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> {{ voice().momentContinue }}</button>
                  }
                }
              } @else {
                <p class="film-tape-sheet-kicker" [class.is-ok]="close()">{{ close() ? 'Called it' : 'Where it turned' }}</p>
                @if (tape.turn; as turn) {
                  <p class="film-tape-sheet-text">{{ turn.why }}</p>
                } @else {
                  <p class="film-tape-sheet-text">The curve never settled on one turning point; the review reads the moments instead.</p>
                }
                <!-- The takeover's guess against the turn is said once, under the scrubber's track, where the two markers stand; the sheet only wears "Called it". -->
                @if (!motion.reduced()) {
                  <p class="film-tape-sheet-hint">Space plays, arrows step a minute, Shift with an arrow jumps to a beat.</p>
                }
              }

              @if (motion.reduced()) {
                <div class="film-tape-steps">
                  <button type="button" class="view-btn" [disabled]="!prevBeat()" (click)="jump(-1)"><span class="material-symbols-rounded" aria-hidden="true">skip_previous</span> Previous beat</button>
                  <button type="button" class="view-btn" [disabled]="!nextBeat()" (click)="jump(1)">Next beat <span class="material-symbols-rounded" aria-hidden="true">skip_next</span></button>
                </div>
              }
            </aside>

            @if (tape.beats.length) {
              <!-- The beats rail: one chip per beat, the current one lit; a tap seeks to it and shows its card without playing. -->
              <ol class="list-clean film-beats" aria-label="The beats of this game">
                @for (b of tape.beats; track b.key) {
                  <li>
                    <button type="button" class="film-beat-chip" [class.is-current]="isCurrent(b)" [class.is-ok]="b.swing === 'us'" [class.is-warn]="b.swing === 'them'" [attr.aria-current]="isCurrent(b) ? 'true' : null" [attr.aria-label]="b.title + ', ' + clockAt(b.sec)" [appTip]="b.title" (click)="showBeat(b)">
                      <app-film-glyph [name]="b.glyph" />
                      <span>{{ minuteOf(b.sec) }}</span>
                    </button>
                  </li>
                }
              </ol>
            }
          </div>

          <div class="film-tape-scrub">
            <app-film-scrubber
              [durationSec]="tape.durationSec"
              [goldDiff]="tape.goldDiff"
              [t]="shownT()"
              [moments]="tape.moments"
              [revealed]="revealed()"
              [guess]="guessShown()"
              [answer]="tape.turn?.minute ?? null"
              [playing]="playing()"
              [ask]="voice().turnQuestion"
              [lockLabel]="voice().lockPill"
              (seek)="seek($event)"
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
  /** The minute the reader said it turned in the takeover, from their progress (calls['turn']); undefined when they never did. */
  readonly guess = input<number | undefined>(undefined);
  /** The second the link opened on (?t=), seeked to once when the clock is made. */
  readonly initialSec = input<number | null>(null);
  /** The page asks for a second, off the map's Watch it. */
  readonly seekTo = input<FilmSeekRequest | null>(null);
  /** Copy link was pressed: the second copied, so the page can put it in the url. */
  readonly copied = output<number>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly motion = inject(MotionService);
  protected readonly ui = inject(UiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dwellBar = viewChild<ElementRef<HTMLElement>>('dwellBar');

  protected readonly Math = Math;
  private readonly clock = signal<FilmClock | null>(null);
  protected readonly t = computed(() => this.clock()?.t() ?? 0);
  protected readonly playing = computed(() => this.clock()?.playing() ?? false);
  protected readonly guessShown = computed<number | null>(() => this.guess() ?? null);
  /** The curve is never hidden on the tape (cut 4): it stands as soon as the chapter has a clock. */
  protected readonly revealed = computed(() => this.clock() !== null);
  /** The curve's draw when the chapter comes up: the second drawn to so far, or null once it is drawn and the clock's own second stands. */
  private readonly drawT = signal<number | null>(null);
  protected readonly shownT = computed(() => this.drawT() ?? this.t());
  protected readonly stop = signal<TapeStop | null>(null);
  /** The dwell running on the beat card: the key of the beat and how long, after the tempo; null when nothing is counting down. */
  protected readonly dwell = signal<{ key: string; ms: number } | null>(null);
  /** Pause was pressed during a dwell: the card holds until Play on. */
  protected readonly held = signal(false);
  private dwellTimer: ReturnType<typeof setTimeout> | undefined;
  private lastT = -1;
  private drawn = false;
  private drawFrame: number | null = null;
  private seekHandled = 0;
  /** Watch it asked for play while the chapter was still off stage: play once it is on. */
  private playWhenActive = false;
  /**
   * The beats already narrated at the second the hand stands on (10 Sep 2026,
   * second review): two beats in one second (grubs and a dragon in one
   * minute, a first tower and an objective) are stopped on one after the
   * other, since the hand cannot cross a second it is standing on. Cleared
   * whenever the hand is moved elsewhere.
   */
  private shownAt: { sec: number; keys: Set<string> } | null = null;

  /** What the clock is keyed on: the game and its length. A rebuilt model (another review landing) keeps the clock and its second. */
  private readonly clockKey = computed(() => {
    const m = this.model();
    return m.tape ? `${m.matchId}:${m.tape.durationSec}` : null;
  });

  protected readonly close = computed(() => {
    const g = this.guessShown();
    const a = this.model().tape?.turn?.minute ?? null;
    return g !== null && a !== null && Math.abs(g - a) <= CLOSE_MINUTES;
  });
  /** The chrome's strings for this film: the pill after a beat, and the scrubber's words. Never the coach's text. */
  protected readonly voice = computed(() => voiceOf(this.model().style));
  /** The seats a beat is about: the map rings their tokens around that second while the hand stands there. */
  protected readonly litSeats = computed<readonly Role[]>(() => {
    const s = this.stop();
    return s?.kind === 'beat' ? (s.beat.seats ?? []) : [];
  });
  /** The beat's second, so only the seat's tokens near it light, not every death and back since minute 0. */
  protected readonly litSec = computed<number | null>(() => {
    const s = this.stop();
    return s?.kind === 'beat' ? s.beat.sec : null;
  });
  protected readonly prevBeat = computed(() => neighbourBeat(this.model().tape?.beats ?? [], this.t(), -1));
  protected readonly nextBeat = computed(() => neighbourBeat(this.model().tape?.beats ?? [], this.t(), 1));

  constructor() {
    // One clock per game, keyed on the match and its length, never on the model's identity; the link's second is the first thing it shows.
    effect((onCleanup) => {
      const key = this.clockKey();
      if (!key) return;
      const durationSec = Number(key.slice(key.lastIndexOf(':') + 1));
      // The film's own rate (0.85, 1 or 1.25 on the base) is a pure function of the match id, so it never moves under a running clock.
      const tapeRate = untracked(() => this.model().style.tapeRate);
      const clock = createFilmClock({ durationSec, secPerGameMinute: RATE * tapeRate });
      untracked(() => {
        // A new game in the same component (the title card links film to film and the page is reused): nothing of the
        // last tape's card, dwell, draw or pending Watch it carries over (10 Sep 2026, second review).
        this.cancelDraw();
        this.cancelDwell();
        this.stop.set(null);
        this.shownAt = null;
        this.drawn = false;
        this.playWhenActive = false;
        const init = this.initialSec();
        if (init !== null && Number.isFinite(init)) clock.seek(init);
        this.lastT = clock.t();
        this.clock.set(clock);
      });
      onCleanup(() => clock.destroy());
    });

    // Only the chapter on stage runs; a Watch it that arrived off stage plays once it is on. Leaving the chapter drops any dwell with the clock.
    effect(() => {
      const active = this.active();
      untracked(() => {
        const clock = this.clock();
        if (!active) {
          this.cancelDwell();
          clock?.pause();
          return;
        }
        if (this.playWhenActive && clock) {
          this.playWhenActive = false;
          if (!this.motion.reduced()) clock.play();
        }
      });
    });

    // The curve draws itself to the hand once, the first time the chapter is up with a clock.
    effect(() => {
      const clock = this.clock();
      if (!clock || !this.active() || this.drawn) return;
      this.drawn = true;
      untracked(() => this.draw(clock));
    });

    // The hand lands on a beat it has just crossed and holds there for its dwell.
    effect(() => {
      const t = this.t();
      const clock = this.clock();
      untracked(() => {
        if (!clock) return;
        const prev = this.lastT;
        this.lastT = t;
        if (!clock.playing() || t <= prev) return;
        const beat = this.nextBeatBetween(prev, t);
        if (!beat) return;
        clock.pause();
        clock.seek(beat.sec);
        this.lastT = beat.sec;
        this.markShown(beat);
        this.stop.set({ kind: 'beat', sec: beat.sec, beat });
        this.startDwell(beat);
      });
    });

    // The dwell bar runs down over the dwell through the one door to the Web Animations API, so its length is the same measured number the timer uses; it dies with the bar.
    afterRenderEffect((onCleanup) => {
      const el = this.dwellBar()?.nativeElement;
      const d = this.dwell();
      if (!el || !d) return;
      untracked(() => void this.motion.play(el, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: d.ms, easing: 'linear', fill: 'forwards' }));
      onCleanup(() => {
        try {
          el.getAnimations().forEach((a) => a.cancel());
        } catch {
          /* no Web Animations: the bar simply stood at its last frame */
        }
      });
    });

    // The page asks for a second: the map's Watch it, twenty seconds before the death.
    effect(() => {
      const req = this.seekTo();
      const clock = this.clock();
      if (!req || !clock || req.n === this.seekHandled) return;
      this.seekHandled = req.n;
      untracked(() => {
        // Watch it is this chapter's first showing when it arrives before the chapter has been up: the hand stands twenty
        // seconds before the death and plays, and the curve is not swept from 0:00 under a clock already running (10 Sep 2026).
        this.drawn = true;
        this.seek(req.sec);
        if (!req.play || this.motion.reduced()) return;
        // The page is still fading the map out when this lands: only the chapter on stage plays.
        if (this.active()) clock.play();
        else this.playWhenActive = true;
      });
    });

    this.destroyRef.onDestroy(() => {
      this.cancelDraw();
      this.cancelDwell();
    });
  }

  /** Where the hand stands when the chapter comes up: the link's second when there is one, else the turning point, else the end so the whole curve shows; then the curve draws to it and the tape plays on. */
  private draw(clock: FilmClock): void {
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

  /** The earliest beat the hand crossed between two seconds, or one still unsaid on the very second it set off from. */
  private nextBeatBetween(prev: number, t: number): FilmBeat | undefined {
    const here = this.shownAt;
    return (this.model().tape?.beats ?? [])
      .filter((b) => b.sec <= t && (b.sec > prev || (here !== null && here.sec === b.sec && !here.keys.has(b.key))))
      .sort((a, b) => a.sec - b.sec)[0];
  }

  /** The card stood on this beat at its second; a sibling in the same second is still owed. */
  private markShown(beat: FilmBeat): void {
    if (this.shownAt?.sec !== beat.sec) this.shownAt = { sec: beat.sec, keys: new Set() };
    this.shownAt.keys.add(beat.key);
  }

  /** The beat's card holds for its dwell, then the tape plays on; never with motion off, where nothing plays on its own. */
  private startDwell(beat: FilmBeat): void {
    this.cancelDwell();
    if (this.motion.reduced()) return;
    const ms = dwellMsFor(beat.text) * this.motion.tempo(this.host.nativeElement);
    this.dwell.set({ key: beat.key, ms });
    this.dwellTimer = setTimeout(() => {
      this.dwell.set(null);
      // The reader may have moved on meanwhile; only a card still standing on this beat plays on.
      const s = this.stop();
      if (s?.kind === 'beat' && s.beat.key === beat.key) this.resume();
    }, ms);
  }

  /** Every path that moves the hand or the card clears the dwell: a seek, a toggle, a token tap, a rail tap, leaving the chapter, destroy. */
  private cancelDwell(): void {
    clearTimeout(this.dwellTimer);
    this.dwellTimer = undefined;
    this.dwell.set(null);
    this.held.set(false);
  }

  protected seek(sec: number): void {
    const clock = this.clock();
    if (!clock) return;
    this.cancelDraw();
    this.cancelDwell();
    clock.seek(sec);
    this.lastT = clock.t();
    this.shownAt = null;
    this.stop.set(null);
  }

  protected toggle(): void {
    const clock = this.clock();
    if (!clock) return;
    this.cancelDwell();
    if (clock.playing()) {
      clock.pause();
      return;
    }
    this.stop.set(null);
    clock.play();
  }

  /** Pause during a dwell: the card holds until Play on. */
  protected hold(): void {
    clearTimeout(this.dwellTimer);
    this.dwellTimer = undefined;
    this.dwell.set(null);
    this.held.set(true);
  }

  /** Continue after a stop: the hand moves on from where it stands. */
  protected resume(): void {
    this.cancelDwell();
    this.stop.set(null);
    if (!this.motion.reduced()) this.clock()?.play();
  }

  /** A beat from the rail, or Shift with an arrow: the hand lands on it and the card reads it, without playing. */
  protected showBeat(b: FilmBeat): void {
    const clock = this.clock();
    if (!clock) return;
    clock.pause();
    this.seek(b.sec);
    this.markShown(b);
    this.stop.set({ kind: 'beat', sec: b.sec, beat: b });
  }

  /** Prev or Next beat with motion off. */
  protected jump(dir: 1 | -1): void {
    const b = dir > 0 ? this.nextBeat() : this.prevBeat();
    if (b) this.showBeat(b);
  }

  /** A token tapped: the hand pauses on its label, and a death of ours brings the film's read of it. */
  protected onTap(tok: RiftToken): void {
    this.cancelDwell();
    this.clock()?.pause();
    const pin = tok.pinKey ? this.model().map?.pins.find((p) => p.key === tok.pinKey) : undefined;
    const line = pin?.readLine || pin?.line;
    this.stop.set({ kind: 'token', sec: tok.sec, label: tok.label, line: line || undefined });
  }

  /** A beat's chip is lit while the card stands on it, or while the hand is within half a minute of it. */
  protected isCurrent(b: FilmBeat): boolean {
    const s = this.stop();
    if (s?.kind === 'beat') return s.beat.key === b.key;
    return Math.abs(this.t() - b.sec) <= BEAT_NEAR_SEC;
  }

  protected swingWord(b: FilmBeat): string {
    return b.swing === 'us' ? 'Our way' : b.swing === 'them' ? 'Their way' : 'Even';
  }

  /** The champions a beat is about, each with the seat the film knows them in; a champion the seats do not carry stands without one. */
  protected tiles(b: FilmBeat): { champion: string; seat?: Role }[] {
    const seats = this.model().seats;
    return (b.champions ?? []).map((champion) => {
      const seat = seats.find((s) => s.champion === champion)?.seat;
      return seat ? { champion, seat } : { champion };
    });
  }

  @HostListener('window:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (!this.active() || !this.clock()) return;
    // A key pressed on the window itself (nothing focused) has no element to ask; the scrubber's track and any control handle their own keys.
    const target = event.target instanceof HTMLElement ? event.target : null;
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
        if (event.shiftKey) {
          const b = neighbourBeat(this.model().tape?.beats ?? [], this.t(), dir);
          if (b) this.showBeat(b);
          else this.seek(dir > 0 ? this.clock()!.durationSec : 0);
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
