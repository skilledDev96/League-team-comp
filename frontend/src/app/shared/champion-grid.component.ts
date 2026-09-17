import { Component, computed, effect, inject, input, output, signal, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
import { Role, ROLES } from '../models/team.models';
import { playsRole } from '../core/champion-lanes';
import { filterChampions } from './comp-board.util';
import { blockedSet, normalizeChampion } from '../pages/tournaments/draft.util';

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

  /** The search box's hint. The draft room's sequence wall names what Enter does on an empty box (17 Sep 2026). */
  readonly placeholder = input('Type a name, Enter takes the top match');

  readonly pick = output<string>();

  /**
   * Enter on an empty search box (17 Sep 2026). The grid still owns no idea of what it means: the draft room's
   * sequence wall holds a ban nobody saw with it, and the comp board does not listen.
   */
  readonly emptyEnter = output<void>();

  /**
   * The lane chip in force, so a caller can follow it.
   *
   * The draft uses this to keep its advice on the same seat the wall is
   * showing: clicking Mid and being told about Jungle is worse than silence.
   */
  readonly laneChange = output<Role | null>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly roles = ROLES;
  protected readonly query = signal('');

  /** The chip in force. Null is "every lane". */
  readonly roleFilter = signal<Role | null>(null);

  /** Set the chip and tell the caller, so both stay on the same seat. */
  chooseLane(role: Role | null): void {
    this.roleFilter.set(role);
    this.laneChange.emit(role);
  }

  constructor() {
    // Follow the aimed seat, but only when it actually changes — otherwise a
    // chip chosen by hand would be overwritten on the next change detection.
    effect(() => {
      const aimed = this.lane();
      this.roleFilter.set(aimed);
      this.laneChange.emit(aimed);
    });
  }

  /**
   * Both sets are keyed through the one champion key (14 Sep 2026). They were keyed by lower case,
   * so a burned "MonkeyKing" or "MissFortune" from a replay never matched the Wukong or Miss Fortune
   * tile and the wall offered a champion the series had already spent. `taken` is re-keyed here too,
   * so a caller's own spelling of its set (the comp board lower-cases, the draft room normalises)
   * cannot decide whether a tick shows.
   */
  private readonly blocked = computed(() => blockedSet(this.unavailable()));
  private readonly takenKeys = computed(() => blockedSet([...this.taken()]));

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
    return this.blocked().has(normalizeChampion(name));
  }

  protected isTaken(name: string): boolean {
    return this.takenKeys().has(normalizeChampion(name));
  }

  /**
   * Enter takes the first champion the search shows that can still be
   * picked. Entering the opponent's pick meant finding one tile in a wall of
   * 173 for every one of their ten actions; three letters and Enter is the
   * whole of it now.
   */
  protected commitFirst(event: Event): void {
    if (!this.query().trim()) {
      event.preventDefault();
      this.emptyEnter.emit();
      return;
    }
    const first = this.grid().find((c) => !this.isBlocked(c.name) && !this.isTaken(c.name));
    if (!first) return;
    event.preventDefault();
    this.choose(first.name);
  }

  /** Put the cursor in the search box, so the next action can be typed. */
  focusSearch(): void {
    const box = this.host.nativeElement.querySelector<HTMLInputElement>('.board-search');
    if (box && document.activeElement !== box) box.focus();
  }

  protected choose(name: string): void {
    if (this.isBlocked(name)) return;
    this.pick.emit(name);
    // The search was for *that* champion. Leaving "ek" in the box means the
    // next pick starts by clearing it, which is a step nobody wants mid-draft.
    this.query.set('');
  }
}
