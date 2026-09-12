import { Component, inject, input } from '@angular/core';
import { DepthSurface } from '../models/team.models';
import { UserPrefsService } from '../services/user-prefs.service';
import { TooltipDirective } from './tooltip.directive';

/**
 * How much of a surface to draw: **Starter** or **Full** (12 Sep 2026).
 *
 * The lead: *"I've got a lot of complaints from too much information to read… maybe we need to
 * introduce all the information gradually."* Measured first — the Games tab put 23 controls and
 * ~85 figures in front of a reader before one game row existed, and Patterns 29 controls and ~70
 * figures before a single section opened.
 *
 * The words are the app's own. Roster, Comps and Player Intel have said Starter | Full since
 * 8 Sep 2026, and Comps' own comment reads *"Start calm: Starter view with comp panels
 * collapsed."* A second vocabulary for the same idea is itself the kind of thing that makes an app
 * feel big, so this is that control made shared and made to persist — those three keep their own
 * signals for now and can be pointed here later.
 *
 * The rule for what sits at which level, applied on every surface: **does a reader act on it, or
 * check it?** Act is Starter, check is Full.
 *
 * The preference is per person, in `UserPrefs.depth`, not per browser like `bom-split-view` and the
 * rest — it is a reading preference and it should follow whoever is reading. Absent means Starter.
 */
@Component({
  selector: 'app-detail-toggle',
  imports: [TooltipDirective],
  template: `
    <div class="field detail-toggle" [attr.data-tour]="'detail-' + surface()">
      <span>Detail</span>
      <div class="view-segment" role="group" aria-label="Detail level">
        <button type="button" [class.active]="!full()" (click)="set(false)" [appTip]="starterTip()">Starter</button>
        <button type="button" [class.active]="full()" (click)="set(true)" [appTip]="fullTip()">Full</button>
      </div>
    </div>
  `
})
export class DetailToggleComponent {
  /** Which surface this toggle speaks for; each is remembered on its own. */
  readonly surface = input.required<DepthSurface>();
  /** What Starter keeps here, and what Full adds — the reader should know before pressing. */
  readonly starterTip = input('The few things to act on');
  readonly fullTip = input('Everything this page knows');

  private readonly prefs = inject(UserPrefsService);

  protected full(): boolean {
    return this.prefs.depthOf(this.surface()) === 'full';
  }

  protected set(full: boolean): void {
    if (full === this.full()) return;
    void this.prefs.setDepth(this.surface(), full);
  }
}
