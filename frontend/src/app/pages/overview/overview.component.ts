import { afterNextRender, Component, computed, effect, inject, Injector, input, signal, untracked } from '@angular/core';
import { RosterCard, RosterGroup, RosterModel } from '../../core/roster-model';
import { MotionService } from '../../services/motion.service';
import { TeamDataService } from '../../services/team-data.service';
import { InViewDirective } from '../../shared/in-view.directive';
import { RosterPanelComponent } from '../roster/poster/roster-panel.component';
import { RosterSheetComponent } from '../roster/poster/roster-sheet.component';

/**
 * Cards, the team poster (13 Sep 2026, the lead: "I love the look of this instead of the summoner icons as
 * main view point … keep the theme of the home page rolling").
 *
 * The A team stands five across over their mains' splash art, the bench and the fill-ins below as shorter
 * tiles, and one player's sheet opens under whichever group they are in. Starter is the poster with a
 * sheet on click; Full adds each panel's numbers and opens the first starter's sheet on arrival. A click
 * turns the choice against the depth, and changing the depth resets it.
 */
@Component({
  selector: 'app-overview',
  imports: [InViewDirective, RosterPanelComponent, RosterSheetComponent],
  templateUrl: './overview.component.html'
})
export class OverviewComponent {
  /** Hosted inside the Roster page, which supplies the heading and the mode switch. */
  readonly embedded = input(false);
  readonly full = input(false);
  readonly model = input.required<RosterModel>();

  private readonly data = inject(TeamDataService);
  private readonly motion = inject(MotionService);
  private readonly injector = inject(Injector);

  /** The poster has come on screen: the rings count from here. */
  protected readonly seen = signal(false);

  /** The chosen card; `null` follows the depth, `'none'` is a sheet closed by hand. */
  private readonly picked = signal<string | null>(null);
  private readonly resetPick = effect(() => {
    this.full();
    untracked(() => this.picked.set(null));
  });
  /**
   * Full opens the first starter's sheet, and the sheet then stays with that player: pinning the id rather
   * than following "whoever is first" keeps the sheet on a player benched from their own sheet, instead of
   * sliding it onto the next starter under the reader's cursor.
   */
  private readonly openFirst = effect(() => {
    const first = this.full() ? this.model().starters[0]?.id : undefined;
    if (first && untracked(() => this.picked()) === null) untracked(() => this.picked.set(first));
  });

  protected readonly selectedId = computed(() => {
    const picked = this.picked();
    return picked !== null && picked !== 'none' && this.cardById(picked) ? picked : null;
  });

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? this.cardById(id) : undefined;
  });

  protected readonly selectedGroup = computed<RosterGroup | null>(() => this.selected()?.group ?? null);

  protected readonly siblings = computed<readonly RosterCard[]>(() => {
    const group = this.selectedGroup();
    return group ? this.model()[group] : [];
  });

  /** The stored player behind the chosen card, for the edit controls. */
  protected readonly selectedPlayer = computed(() => {
    const id = this.selected()?.playerId;
    return id ? this.data.players().find((p) => p.id === id) : undefined;
  });

  /** Five across, or more when two starters share a seat. */
  protected readonly posterCols = computed(() => Math.max(5, this.model().starters.length));

  private cardById(id: string): RosterCard | undefined {
    const m = this.model();
    return m.starters.find((c) => c.id === id) ?? m.bench.find((c) => c.id === id) ?? m.fillIns.find((c) => c.id === id);
  }

  protected toggle(id: string, keyboard: boolean): void {
    if (this.selectedId() === id) {
      this.close();
      return;
    }
    this.show(id, keyboard);
  }

  protected show(id: string, keyboard = false): void {
    this.picked.set(id);
    afterNextRender(
      () => {
        const sheet = document.getElementById('roster-sheet');
        sheet?.scrollIntoView?.({ block: 'nearest', behavior: this.motion.reduced() ? 'auto' : 'smooth' });
        if (keyboard) document.getElementById('roster-sheet-title')?.focus({ preventScroll: true });
      },
      { injector: this.injector }
    );
  }

  /** Close the sheet and hand focus back to the panel that opened it. */
  protected close(): void {
    const id = this.selectedId();
    this.picked.set('none');
    if (id) {
      afterNextRender(() => document.getElementById(`roster-open-${id}`)?.focus({ preventScroll: true }), { injector: this.injector });
    }
  }
}
