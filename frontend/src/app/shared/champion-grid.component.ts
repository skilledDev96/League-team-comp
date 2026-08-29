import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
import { Role } from '../models/team.models';
import { playsRole } from '../core/champion-lanes';
import { filterChampions } from './comp-board.util';

/** The class chips above the grid, in the order they read as a comp. */
const CLASS_TAGS = ['Tank', 'Fighter', 'Assassin', 'Mage', 'Marksman', 'Support'];

/**
 * A searchable wall of champions that reports what was clicked.
 *
 * Lifted out of the comp board so the tournament draft can use the same one.
 * It deliberately owns no idea of *where* a pick lands — the comp board sends
 * it to a role slot, the draft screen sends it to a ban or to either team —
 * so the only thing it emits is a champion name.
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
   * Narrow the wall to champions played in this lane.
   *
   * Set from the seat being drafted, so aiming at Jungle shows junglers without
   * anyone reaching for a filter. A champion with no pro games survives every
   * lane filter — see `playsRole` — because hiding one entirely is worse than
   * offering it in the wrong lane.
   */
  readonly lane = input<Role | null>(null);
  /** Escape hatch: some drafts want the off-meta pick the lane filter hides. */
  readonly showAllLanes = signal(false);

  readonly pick = output<string>();

  protected readonly classTags = CLASS_TAGS;
  protected readonly query = signal('');
  protected readonly tag = signal<string | null>(null);

  private readonly blocked = computed(
    () => new Set(this.unavailable().map((c) => c.toLowerCase()))
  );

  protected readonly grid = computed(() => {
    const found = filterChampions(this.champs.champions(), this.query(), this.tag());
    const lane = this.lane();
    if (!lane || this.showAllLanes()) return found;
    return found.filter((c) => playsRole(c.name, lane));
  });

  /** How many the lane filter is holding back, so the escape hatch is honest. */
  protected readonly hiddenByLane = computed(() => {
    const lane = this.lane();
    if (!lane || this.showAllLanes()) return 0;
    const found = filterChampions(this.champs.champions(), this.query(), this.tag());
    return found.length - found.filter((c) => playsRole(c.name, lane)).length;
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
