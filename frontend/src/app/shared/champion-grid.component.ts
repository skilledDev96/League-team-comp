import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
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
  readonly pick = output<string>();

  protected readonly classTags = CLASS_TAGS;
  protected readonly query = signal('');
  protected readonly tag = signal<string | null>(null);

  private readonly blocked = computed(
    () => new Set(this.unavailable().map((c) => c.toLowerCase()))
  );

  protected readonly grid = computed(() =>
    filterChampions(this.champs.champions(), this.query(), this.tag())
  );

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
