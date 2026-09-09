import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FilmCall, FilmModel } from '../../../core/film-model';
import { shuffle } from '../../../core/seed';
import { TeamDataService } from '../../../services/team-data.service';
import { FilmFrameComponent, themeIcon } from '../film-frame.component';

/** The circumference of the tally ring. */
const RING = 2 * Math.PI * 28;

interface ShownItem extends FilmCall {
  /** False for the commitment item until the team has chosen; it is shown but not counted. */
  counts: boolean;
}

/**
 * Call it back (9 Sep 2026): the five items one at a time, big targets and
 * no timer. A tap answers; the right option is marked and the fact's own
 * line appears, then Next. The commitment item takes its answer from the
 * team's pick when there is one and otherwise shows without a right answer.
 * The run ends on a tally ring, never a percentage, and Again reshuffles
 * the options by the seed and the attempt so the questions stay put.
 */
@Component({
  selector: 'app-film-callback',
  imports: [FilmFrameComponent],
  template: `
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (!items().length) {
        <p class="film-wait">Nothing to call back for this game yet.</p>
      } @else if (!finished()) {
        @let item = items()[at()];
        @let pick = pickOf(at());
        <div class="film-cb">
          <p class="film-cb-step">
            @for (it of items(); track it.key; let i = $index) {
              <span class="film-cb-dot" [class.is-done]="pickOf(i) !== undefined" [class.is-now]="i === at()" [class.is-hit]="pickOf(i) !== undefined && pickOf(i) === it.answer"></span>
            }
          </p>
          <p class="film-cb-q">
            @if (item.theme) { <span class="material-symbols-rounded" aria-hidden="true">{{ icon(item.theme) }}</span> }
            {{ item.question }}
          </p>
          <div class="film-cb-options" role="group" [attr.aria-label]="item.question">
            @for (opt of item.options; track $index; let i = $index) {
              <button
                type="button"
                class="film-cb-option"
                [class.is-right]="pick !== undefined && item.counts && i === item.answer"
                [class.is-wrong]="pick === i && item.counts && i !== item.answer"
                [class.is-picked]="pick === i"
                [disabled]="pick !== undefined"
                [attr.aria-pressed]="pick === i"
                (click)="answer(i)"
              >
                {{ opt }}
              </button>
            }
          </div>
          @if (pick !== undefined) {
            <p class="film-cb-why">
              @if (!item.counts) {
                <span class="film-cb-mark">Nothing committed yet</span>
              } @else if (pick === item.answer) {
                <span class="film-cb-mark is-ok"><span class="material-symbols-rounded" aria-hidden="true">check</span> Called it</span>
              } @else {
                <span class="film-cb-mark is-warn"><span class="material-symbols-rounded" aria-hidden="true">close</span> It was {{ item.options[item.answer] }}</span>
              }
              {{ item.why }}
            </p>
            <button type="button" class="view-btn active film-cb-next" (click)="advance()">{{ at() < items().length - 1 ? 'Next' : 'The tally' }}</button>
          }
        </div>
      } @else {
        <div class="film-tally">
          <svg class="film-ring is-tally" viewBox="0 0 64 64" aria-hidden="true">
            <circle class="film-ring-track" cx="32" cy="32" r="28" />
            <circle class="film-ring-fill" cx="32" cy="32" r="28" [style.--film-ring-c]="ring" [style.stroke-dasharray]="ring" [style.stroke-dashoffset]="ringOffset()" />
          </svg>
          <p class="film-tally-line">Called <b>{{ called() }}</b> of {{ of() }}</p>
          @if (of() < items().length) { <p class="film-tally-note muted">The commitment waits for the team's pick.</p> }
          <div class="film-tally-actions">
            <button type="button" class="view-btn" (click)="again()"><span class="material-symbols-rounded" aria-hidden="true">replay</span> Again</button>
            <button type="button" class="view-btn active" (click)="next.emit()">On to the card</button>
          </div>
        </div>
      }
    </app-film-frame>
  `
})
export class FilmCallbackComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('Call it back');
  readonly index = input<number>(3);
  readonly count = input<number>(1);
  /** The calls made on an earlier visit; an item already answered shows its reveal. */
  readonly calls = input<Record<string, number> | undefined>(undefined);
  readonly answered = output<{ key: string; choice: number }>();
  readonly tally = output<{ called: number; of: number }>();
  readonly next = output<void>();
  readonly back = output<void>();

  private readonly data = inject(TeamDataService);

  protected readonly ring = RING;
  protected readonly at = signal(0);
  /** Set by The tally and Again; until then a return with every item already called opens on the tally. */
  private readonly finishedNow = signal<boolean | undefined>(undefined);
  private readonly attempt = signal(0);
  private readonly picks = signal<ReadonlyMap<number, number>>(new Map());

  /** The commitment item's answer, from the team's pick; -1 until there is one. */
  private readonly commitAnswer = computed(() => {
    const c = this.data.commitmentFor(this.model().matchId);
    if (!c || !Object.keys(c.by).length) return -1;
    const choice = this.data.teamChoice(c);
    return choice === 'a' ? 0 : choice === 'b' ? 1 : -1;
  });

  protected readonly items = computed<ShownItem[]>(() => {
    const m = this.model();
    const attempt = this.attempt();
    return m.callback.map((item) => {
      if (item.answer < 0) {
        // A and B stay in order whatever the attempt: the team's choice names a letter.
        return { ...item, answer: this.commitAnswer(), counts: this.commitAnswer() >= 0 };
      }
      if (!attempt) return { ...item, counts: true };
      const order = shuffle(
        m.seed,
        item.options.map((_, i) => i),
        item.key + ':' + attempt
      );
      return { ...item, options: order.map((i) => item.options[i]), answer: order.indexOf(item.answer), counts: true };
    });
  });

  /** On the first attempt an earlier visit's calls stand; a fresh attempt starts clean. */
  private readonly restored = computed<ReadonlyMap<number, number>>(() => {
    const map = new Map<number, number>();
    if (this.attempt()) return map;
    const calls = this.calls() ?? {};
    this.items().forEach((item, i) => {
      const c = calls[item.key];
      if (c !== undefined && c >= 0 && c < item.options.length) map.set(i, c);
    });
    return map;
  });

  /** Finished by The tally, or on a return where every item was called on an earlier visit and none this one. */
  protected readonly finished = computed(() => this.finishedNow() ?? (this.picks().size === 0 && this.items().length > 0 && this.items().every((_, i) => this.restored().has(i))));
  protected readonly called = computed(() => this.items().filter((it, i) => it.counts && this.pickOf(i) === it.answer).length);
  protected readonly of = computed(() => this.items().filter((it) => it.counts).length);

  protected pickOf(i: number): number | undefined {
    return this.picks().get(i) ?? this.restored().get(i);
  }

  protected answer(i: number): void {
    const at = this.at();
    if (this.pickOf(at) !== undefined) return;
    this.picks.set(new Map(this.picks()).set(at, i));
    this.answered.emit({ key: this.items()[at].key, choice: i });
  }

  protected advance(): void {
    if (this.at() < this.items().length - 1) {
      this.at.set(this.at() + 1);
      return;
    }
    this.finishedNow.set(true);
    this.tally.emit({ called: this.called(), of: this.of() });
  }

  protected again(): void {
    this.attempt.set(this.attempt() + 1);
    this.picks.set(new Map());
    this.at.set(0);
    this.finishedNow.set(false);
  }

  protected ringOffset(): number {
    const of = this.of();
    return of ? RING * (1 - this.called() / of) : RING;
  }

  protected icon(theme: string | undefined): string {
    return themeIcon(theme);
  }
}
