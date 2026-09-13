import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LastMvpService } from '../services/last-mvp.service';
import { UiService } from '../services/ui.service';
import { TooltipDirective } from './tooltip.directive';

/**
 * The MVP banner (13 Sep 2026): a small gold ribbon that follows the MVP of the last series wherever their name is
 * printed, and nothing at all beside anyone else. Give it the player's id when the site has one and the name when it
 * has only that; `LastMvpService` decides.
 *
 * Not a button, like the MVP chip: it is focusable so the tooltip — which series, on what, when — reaches a keyboard.
 * `size`: `chip` beside a name in prose or a head, `inline` inside a table cell or a small line, `tile` over splash art.
 */
@Component({
  selector: 'app-mvp-banner',
  imports: [TooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <span class="mvp-banner" [class.is-inline]="size() === 'inline'" [class.is-tile]="size() === 'tile'" [attr.tabindex]="focusable() ? 0 : null" [appTip]="tip()">
        <span class="material-symbols-rounded" aria-hidden="true">workspace_premium</span>
        <span class="mvp-banner-word">MVP</span>
        <span class="visually-hidden">{{ tip() }}</span>
      </span>
    }
  `
})
export class MvpBannerComponent {
  readonly playerId = input<string | null | undefined>(null);
  readonly name = input<string | null | undefined>(null);
  readonly size = input<'chip' | 'inline' | 'tile'>('chip');
  /** Off inside a button or a link, which is the tab stop already; the tip still answers a hover. */
  readonly focusable = input(true);

  private readonly mvp = inject(LastMvpService);
  private readonly ui = inject(UiService);

  protected readonly show = computed(() => this.mvp.isHolder(this.playerId(), this.name()));

  protected readonly tip = computed(() => {
    const h = this.mvp.holder();
    if (!h) return '';
    const when = h.at ? ` on ${new Date(h.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '';
    return `MVP of the last series: vs ${h.opponent}, ${this.ui.championName(h.champion)}${when}. Theirs until the next series crowns someone.`;
  });
}
