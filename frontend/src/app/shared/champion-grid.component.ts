import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
import { Role, ROLES } from '../models/team.models';
import { playsRole } from '../core/champion-lanes';
import { filterChampions } from './comp-board.util';

/**
 * A searchable wall of champions that reports what was clicked.
 *
 * Lifted out of the comp board so the tournament draft can use the same one.
 * It deliberately owns no idea of *where* a pick lands — the comp board sends
 * it to a role slot, the draft screen sends it to a ban or to either team —
 * so the only thing it emits is a champion name.
 *
 * Filtering is by **lane**, not by Riot's class tags. The tags were a poor
 * proxy — "Support" appeared as both a class and a lane, and Fighter and Mage
 * spanned every seat on the map — so they told you almost nothing about where a
 * champion can go. Lanes come from pro match data and answer the question that
 * is actually being asked mid-draft.
 *
 * `unavailable` greys a champion out and refuses the click; `taken` marks one
 * that is already placed but can still be clicked, which is how both callers
 * let you click a champion a second time to take it back off.
 */
@Component({
  selector: 'app-champion-grid',
  imports: [FormsModule],
  templateUrl: './champion-grid.component.html'
})
export class ChampionGridComponent {
  protected readonly champs = inject(ChampionDataService);
  protected readonly ui = inject(UiService);

  /** Champions that cannot be picked here — burned, banned, or already drafted. */
  readonly unavailable = input<readonly string[]>([]);
  /** Champions already placed by this caller, shown with a tick. */
  readonly taken = input<ReadonlySet<string>>(new Set<string>());
  /**
   * The lane the caller is aiming at, which seeds the filter — aiming a seat
   * shows that seat's champions without anyone reaching for a chip. Whatever
   * is chosen here can still be overridden by clicking a chip.
   */
  readonly lane = input<Role | null>(null);

  readonly pick = output<string>();

  protected readonly roles = ROLES;
  protected readonly query = signal('');

  /** The chip in force. Null is "every lane". */
  protected readonly roleFilter = signal<Role | null>(null);

  constructor() {
    // Follow the aimed seat, but only when it actually changes — otherwise a
    // chip chosen by hand would be overwritten on the next change detection.
    effect(() => {
      const aimed = this.lane();
      this.roleFilter.set(aimed);
    });
  }

  private readonly blocked = computed(
    () => new Set(this.unavailable().map((c) => c.toLowerCase()))
  );

  protected readonly grid = computed(() => {
    const found = filterChampions(this.champs.champions(), this.query(), null);
    const role = this.roleFilter();
    return role ? found.filter((c) => playsRole(c.name, role)) : found;
  });

  /** How many the lane filter is holding back, so the chip is honest. */
  protected readonly hiddenByLane = computed(() => {
    const role = this.roleFilter();
    if (!role) return 0;
    const found = filterChampions(this.champs.champions(), this.query(), null);
    return found.length - found.filter((c) => playsRole(c.name, role)).length;
  });

  protected isBlocked(name: string): boolean {
    return this.blocked().has(name.toLowerCase());
  }

  protected isTaken(name: string): boolean {
    return this.taken().has(name.toLowerCase());
  }

  protected choose(name: string): void {
    if (this.isBlocked(name)) return;
    this.pick.emit(name);
  }
}
