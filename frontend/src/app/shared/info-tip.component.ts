import { Component, input } from '@angular/core';
import { TooltipDirective } from './tooltip.directive';

/**
 * A small ⓘ that holds a sentence the page used to print in full.
 *
 * The rule behind it (8 Sep 2026): explanatory prose stays on the page only
 * when it tells a viewer what would fill an empty space. A caveat or a
 * definition a reader wants once goes here, where it costs no height and is
 * still one hover away.
 */
@Component({
  selector: 'app-info-tip',
  imports: [TooltipDirective],
  template: `
    <button type="button" class="info-tip" [appTip]="text()" [attr.aria-label]="label()">
      <span class="material-symbols-rounded" aria-hidden="true">info</span>
    </button>
  `
})
export class InfoTipComponent {
  readonly text = input.required<string>();
  readonly label = input('More about this');
}
