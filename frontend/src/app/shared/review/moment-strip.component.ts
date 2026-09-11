import { Component, computed, effect, input, output, signal } from '@angular/core';
import { momentTrack } from '../../core/review-view';
import { ReviewMoment } from '../../models/team.models';

/**
 * The game as its moments (12 Sep 2026), on a track rather than in a row.
 *
 * A row of evenly spaced pills says a game had six moments. Placed along the game's own length it
 * says *when*: three of them inside the last eight minutes reads at a glance as a game that was
 * fine until it was not, which is the shape a coach is looking for and the one even spacing threw
 * away. The lead asked to look at something and know instantly what it is about — this is the one
 * piece of the panel that can answer that with position alone.
 *
 * Three honest shapes, and the strip picks between them rather than faking the first:
 *
 * - **The track**, when the review is timed and the game has a length. `momentTrack` places each
 *   pill and guarantees a readable gap.
 * - **The row**, for one moment, or a timed review of a game the analysis no longer carries a
 *   length for. A lone pill on a track is a dot on a line.
 * - **Dots**, for a totals-only review, whose moments are in order but have no real minutes.
 *
 * The sentence is under the strip and one moment at a time, as it always was: tapping is how a
 * reader asks for words, which is the whole trade the rebuilt panel makes.
 */
@Component({
  selector: 'app-moment-strip',
  template: `
    <div class="game-review-moment-strip" [class.is-untimed]="!timed()" [class.is-track]="onTrack()">
      @if (onTrack()) {
        <div class="moment-track" role="group" aria-label="The game in moments">
          <span class="moment-track-line" aria-hidden="true"></span>
          @for (m of moments(); track $index) {
            <button type="button" class="moment-minute" [style.left.%]="track()[$index]"
                    [class.is-us]="m.swing === 'us'" [class.is-them]="m.swing === 'them'" [class.active]="picked() === $index"
                    [attr.aria-pressed]="picked() === $index" [attr.aria-label]="'Minute ' + m.minute" (click)="pick($index)">
              {{ m.minute }}<small>min</small>
            </button>
          }
        </div>
      } @else {
        <div class="moment-strip-row" role="group" aria-label="The game in moments">
          @for (m of moments(); track $index) {
            <button type="button" class="moment-minute" [class.is-us]="m.swing === 'us'" [class.is-them]="m.swing === 'them'" [class.active]="picked() === $index"
                    [attr.aria-pressed]="picked() === $index" [attr.aria-label]="timed() ? 'Minute ' + m.minute : 'Moment ' + ($index + 1)" (click)="pick($index)">
              @if (timed()) { {{ m.minute }}<small>min</small> } @else { <span class="moment-dot" aria-hidden="true"></span> }
            </button>
          }
        </div>
      }
      @if (pickedMoment(); as m) {
        <p class="moment-picked" [class.is-us]="m.swing === 'us'" [class.is-them]="m.swing === 'them'">{{ m.text }}</p>
      } @else {
        <p class="moment-picked muted">{{ timed() ? 'Tap a minute for what happened there.' : 'Tap a moment for what happened there.' }}</p>
      }
    </div>
  `
})
export class MomentStripComponent {
  readonly moments = input<ReviewMoment[]>([]);
  /** Whether the minutes are real; a totals-only review has moments in order and no clock. */
  readonly timed = input<boolean>(false);
  /** The game's own length, which is what turns the row into a track. */
  readonly durationSec = input<number | undefined>(undefined);
  /** The moment a reader opened, so a host can follow it; nothing is open to start. */
  readonly opened = output<number | null>();

  protected readonly track = computed(() =>
    this.timed() ? momentTrack(this.moments().map((m) => m.minute), this.durationSec()) : []
  );
  protected readonly onTrack = computed(() => this.track().length === this.moments().length && this.moments().length > 1);

  protected readonly picked = signal<number | null>(null);
  protected readonly pickedMoment = computed(() => {
    const i = this.picked();
    return i === null ? undefined : this.moments()[i];
  });

  constructor() {
    // A re-review rewrites the moments, so an open sentence would point at a different one.
    effect(() => {
      this.moments();
      this.picked.set(null);
    });
  }

  protected pick(index: number): void {
    const next = this.picked() === index ? null : index;
    this.picked.set(next);
    this.opened.emit(next);
  }
}
