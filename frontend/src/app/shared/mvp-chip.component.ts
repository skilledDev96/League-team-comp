import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Role } from '../models/team.models';
import { UiService } from '../services/ui.service';
import { TooltipDirective } from './tooltip.directive';

/** The three marks this chip carries: who carried a game, who carried a series, and who swung the gold most. */
export type MvpChipKind = 'mvp' | 'series' | 'swing';

const WORDS: Record<MvpChipKind, string> = { mvp: 'MVP', series: 'Series MVP', swing: 'Swung it most' };

/**
 * The MVP mark (11 Sep 2026, queue items 5-7): the champion's tile, the
 * word, the name, and the terms behind it in the tooltip — because a mark
 * nobody can see the parts of is a number to be argued with, and these are
 * meant to be read.
 *
 * Not a button: it does nothing, the way the row's Reviewed chip does
 * nothing. It is focusable so the tooltip reaches a keyboard, which is the
 * only place the terms live.
 *
 * `compact` is the game row's size, where the chip stands in a summary line
 * beside Reviewed; the word goes off the screen (not out of the tree) on a
 * phone, the same recipe the Reviewed chip uses, so the mark survives a
 * narrow row and a screen reader still hears it.
 */
@Component({
  selector: 'app-mvp-chip',
  imports: [TooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="mvp-chip"
      [class.is-mvp]="kind() === 'mvp'"
      [class.is-series]="kind() === 'series'"
      [class.is-swing]="kind() === 'swing'"
      [class.is-compact]="compact()"
      tabindex="0"
      [appTip]="tip()"
    >
      @if (champion()) {
        <img class="mvp-chip-icon" [src]="ui.championIconUrl(champion())" alt="" loading="lazy" />
      }
      <span class="mvp-chip-word">{{ word() }}</span>
      @if (label()) { <span class="mvp-chip-name">{{ label() }}</span> }
      @if (count(); as c) { <span class="mvp-chip-count" [class.is-partial]="partial()">{{ c }}</span> }
    </span>
  `
})
export class MvpChipComponent {
  readonly kind = input<MvpChipKind>('mvp');
  readonly champion = input<string>('');
  /** Our roster member, when the game named one; the champion stands in when it did not. */
  readonly name = input<string>('');
  readonly seat = input<Role | ''>('');
  /** The terms behind the mark, as the core modules wrote them; the tooltip is the only place they show. */
  readonly terms = input<readonly string[]>([]);
  /** A closing sentence: what the average is over, or what the gold curve cannot see. */
  readonly note = input<string>('');
  /**
   * For a series mark: how many games carried figures, and how many the series has (12 Sep 2026).
   *
   * An average with nothing saying what it averaged is the thing that made this mark look broken —
   * a Bo3 with one replay imported drew a "Series MVP" indistinguishable from one built out of
   * three games. Zero means do not print a count, which is what every other kind passes.
   */
  readonly read = input<number>(0);
  readonly of = input<number>(0);
  readonly compact = input<boolean>(false);

  protected readonly ui = inject(UiService);

  protected readonly word = computed(() => WORDS[this.kind()]);

  /** The champion the display way ("Wukong", never "MonkeyKing"), empty when the source named none. */
  protected readonly championLabel = computed(() => (this.champion() ? this.ui.championName(this.champion()) : ''));

  /** What the chip says beside the word: the person when we know them, else the champion, else the seat. */
  protected readonly label = computed(() => (this.compact() ? '' : this.name() || this.championLabel() || this.seat()));

  /** "Rhu on Jinx", "Jinx", or the seat: whoever the game can name. */
  protected readonly who = computed(() => {
    const champ = this.championLabel();
    const name = this.name();
    if (name && champ) return `${name} on ${champ}`;
    return name || champ || this.seat() || 'this seat';
  });

  /** "3 games" when it read them all, "1 of 3" when it did not, nothing when there is no count. */
  protected readonly count = computed(() => {
    const [read, of] = [this.read(), this.of()];
    if (!of || !read) return '';
    if (read < of) return `${read} of ${of}`;
    return `${of} ${of === 1 ? 'game' : 'games'}`;
  });

  /** The count is worth a second colour only when it is admitting it saw less than the whole series. */
  protected readonly partial = computed(() => this.of() > 0 && this.read() > 0 && this.read() < this.of());

  protected readonly tip = computed(() => {
    const terms = this.terms().filter((t) => t.trim());
    return [`${this.word()}: ${this.who()}.`, terms.length ? `${terms.join(' · ')}.` : '', this.note().trim()].filter(Boolean).join(' ');
  });
}
