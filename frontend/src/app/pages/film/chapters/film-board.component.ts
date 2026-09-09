import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FilmModel } from '../../../core/film-model';
import { BARON_PIT, DRAGON_PIT, Point } from '../../../core/rift-zones';
import { RiftMapComponent } from '../../../shared/film/rift-map.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';

/** Where each count sits on the Rift: dragons at their pit, the Baron pit's three stacked, kills and towers stacked at the centre. Counts share a spot, so none of them is placed by zone. */
const CHIP_SPOTS: Record<string, Point> = {
  Kills: { x: 50, y: 50 },
  Towers: { x: 50, y: 50 },
  Dragons: DRAGON_PIT,
  Barons: BARON_PIT,
  Heralds: BARON_PIT,
  Grubs: BARON_PIT
};

interface BoardChip {
  label: string;
  ours: number;
  theirs: number;
  x: number;
  y: number;
  /** The chip's place in a stack at the same spot, for the offset. */
  stack: number;
}

interface BoardBar {
  label: string;
  ours: number;
  theirs: number;
  /** Widths as a percent of the largest count on the board. */
  oursPct: number;
  theirsPct: number;
  widest: boolean;
}

/**
 * The board (9 Sep 2026), the replay tier's stand-in for the tape: the Rift
 * dim and still with the game's counts sitting where they happened, hidden
 * until the reader has called which count was furthest apart. On the
 * answer the paired bars race in, the widest gap is marked, and the
 * moments run down the side as a rail coloured by swing, each opening on a
 * tap. A replay carries totals only, and the chapter says so once.
 */
@Component({
  selector: 'app-film-board',
  imports: [TooltipDirective, FilmFrameComponent, RiftMapComponent],
  template: `
    @let board = model().board;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (board) {
        <div class="film-board" [class.is-revealed]="revealed()">
          <div class="film-board-map">
            <app-rift-map [dim]="true" [note]="false" />
            <div class="film-board-chips" aria-hidden="true">
              @for (c of chips(); track c.label) {
                <span class="film-board-chip" [style.left.%]="c.x" [style.top.%]="c.y" [style.--stack]="c.stack" [style.--i]="$index">
                  <small>{{ c.label }}</small>
                  @if (revealed()) { <b>{{ c.ours }}<i>-</i>{{ c.theirs }}</b> } @else { <b>?</b> }
                </span>
              }
            </div>
          </div>

          <div class="film-board-side">
            @if (board.call; as call) {
              <div class="film-call" [class.is-done]="revealed()">
                <p class="film-call-q">{{ call.question }}</p>
                <div class="film-chips" role="group" [attr.aria-label]="call.question">
                  @for (opt of call.options; track opt; let i = $index) {
                    <button
                      type="button"
                      class="film-chip"
                      [style.--i]="i"
                      [class.is-right]="revealed() && i === call.answer"
                      [class.is-wrong]="picked() === i && i !== call.answer"
                      [class.is-pulse]="revealed() && picked() !== null && picked() !== call.answer && i === call.answer"
                      [disabled]="revealed()"
                      [attr.aria-pressed]="picked() === i"
                      (click)="choose(i)"
                    >
                      {{ opt }}
                    </button>
                  }
                </div>
                @if (!revealed()) {
                  <button type="button" class="view-btn film-skip" (click)="skip()">Skip the call</button>
                } @else if (picked() !== null) {
                  <p class="film-call-why">{{ picked() === call.answer ? 'Called it. ' : '' }}{{ call.why }}.</p>
                }
              </div>
            } @else if (board.tallies.length) {
              <p class="film-call-why">Every count ended level.</p>
            }

            @if (revealed() && bars().length) {
              <ul class="list-clean film-board-bars" aria-label="The counts">
                @for (b of bars(); track b.label) {
                  <li class="film-board-bar" [class.is-widest]="b.widest" [style.--i]="$index">
                    <span class="film-board-bar-label">{{ b.label }} @if (b.widest) { <em>Furthest apart</em> }</span>
                    <span class="film-board-bar-pair">
                      <span class="film-board-bar-track is-us"><i [style.width.%]="b.oursPct"></i></span>
                      <b class="film-board-bar-n">{{ b.ours }}</b>
                      <b class="film-board-bar-n is-them">{{ b.theirs }}</b>
                      <span class="film-board-bar-track is-them"><i [style.width.%]="b.theirsPct"></i></span>
                    </span>
                  </li>
                }
              </ul>
            }

            <p class="film-board-note">A replay carries totals only.</p>
          </div>

          @if (board.moments.length) {
            <ol class="list-clean film-board-rail" aria-label="Moments">
              @for (m of board.moments; track m.minute + ':' + m.text; let i = $index) {
                <li [style.--i]="i">
                  <button type="button" [class]="'film-board-moment is-' + m.swing" [class.is-open]="open() === i" [attr.aria-expanded]="open() === i" [appTip]="open() === i ? '' : m.text" (click)="toggle(i)">
                    <span class="film-board-moment-min">{{ m.minute }}<small>min</small></span>
                    <span class="film-board-moment-text">{{ m.text }}</span>
                  </button>
                </li>
              }
            </ol>
          }
        </div>
      } @else {
        <p class="film-wait">This review carries no counts to put on the board.</p>
      }
    </app-film-frame>
  `
})
export class FilmBoardComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The board');
  readonly index = input<number>(1);
  readonly count = input<number>(1);
  /** Bumped by the page on Escape: the open moment folds. */
  readonly closeTick = input<number>(0);
  /** The option chosen on an earlier visit, so the board is already up. */
  readonly earlier = input<number | undefined>(undefined);
  readonly answered = output<{ key: string; choice: number }>();
  readonly next = output<void>();
  readonly back = output<void>();

  private readonly pickedNow = signal<number | null>(null);
  private readonly skipped = signal(false);
  protected readonly open = signal<number | null>(null);

  protected readonly picked = computed<number | null>(() => {
    const now = this.pickedNow();
    if (now !== null) return now;
    const before = this.earlier();
    return before === undefined || before < 0 ? null : before;
  });
  protected readonly revealed = computed(() => !this.model().board?.call || this.picked() !== null || this.skipped());

  protected readonly chips = computed<BoardChip[]>(() => {
    const tallies = this.model().board?.tallies ?? [];
    // Chips on the same spot stack down it, in the board's own order.
    const atSpot = new Map<string, number>();
    return tallies.map((t) => {
      const spot = CHIP_SPOTS[t.label] ?? { x: 50, y: 50 };
      const at = `${spot.x},${spot.y}`;
      const stack = atSpot.get(at) ?? 0;
      atSpot.set(at, stack + 1);
      return { label: t.label, ours: t.ours, theirs: t.theirs, x: spot.x, y: spot.y, stack };
    });
  });

  protected readonly bars = computed<BoardBar[]>(() => {
    const tallies = this.model().board?.tallies ?? [];
    const max = Math.max(1, ...tallies.flatMap((t) => [t.ours, t.theirs]));
    const widestGap = Math.max(0, ...tallies.map((t) => Math.abs(t.ours - t.theirs)));
    let marked = false;
    return tallies.map((t) => {
      const widest = !marked && widestGap > 0 && Math.abs(t.ours - t.theirs) === widestGap;
      if (widest) marked = true;
      return { label: t.label, ours: t.ours, theirs: t.theirs, oursPct: (t.ours / max) * 100, theirsPct: (t.theirs / max) * 100, widest };
    });
  });

  constructor() {
    effect(() => {
      this.closeTick();
      this.open.set(null);
    });
  }

  protected choose(i: number): void {
    if (this.revealed()) return;
    this.pickedNow.set(i);
    this.answered.emit({ key: 'board', choice: i });
  }

  protected skip(): void {
    this.skipped.set(true);
  }

  protected toggle(i: number): void {
    this.open.set(this.open() === i ? null : i);
  }
}
