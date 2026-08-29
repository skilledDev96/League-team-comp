import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
import { CompPicks, Role, ROLES } from '../models/team.models';
import {
  championOf,
  championsInComp,
  filterChampions,
  nextEmptySlot,
  noteOf,
  setChampionInLine
} from './comp-board.util';

/** The class chips above the grid, in the order they read as a comp. */
const CLASS_TAGS = ['Tank', 'Fighter', 'Assassin', 'Mage', 'Marksman', 'Support'];

/**
 * Build a comp by clicking, the way the League client and every draft tool
 * work: five role slots above a searchable champion grid, one click per pick.
 *
 * Replaces a form where each role was a separate text field with its own
 * typeahead. The slot takes the focus, the grid fills it, and focus advances —
 * so a five-champion comp is five clicks rather than five find-field-type-select
 * cycles.
 *
 * Notes on a slot survive a champion change: the note is usually the reason the
 * pick is there, and losing it on a swap would punish exactly the person who
 * documented their thinking.
 */
@Component({
  selector: 'app-comp-board',
  imports: [FormsModule],
  templateUrl: './comp-board.component.html'
})
export class CompBoardComponent {
  protected readonly champs = inject(ChampionDataService);
  protected readonly ui = inject(UiService);

  readonly picks = input.required<CompPicks>();
  /** Champions unavailable here — burned in a fearless series, or already banned. */
  readonly unavailable = input<readonly string[]>([]);
  readonly picksChange = output<CompPicks>();

  protected readonly roles = ROLES;
  protected readonly classTags = CLASS_TAGS;

  protected readonly focused = signal<Role>('Top');
  protected readonly query = signal('');
  protected readonly tag = signal<string | null>(null);

  protected readonly championOf = championOf;
  protected readonly noteOf = noteOf;

  private readonly blocked = computed(
    () => new Set(this.unavailable().map((c) => c.toLowerCase()))
  );

  protected readonly taken = computed(() => championsInComp(this.picks()));

  protected readonly grid = computed(() =>
    filterChampions(this.champs.champions(), this.query(), this.tag())
  );

  protected isBlocked(name: string): boolean {
    return this.blocked().has(name.toLowerCase());
  }

  protected isTaken(name: string): boolean {
    return this.taken().has(name.toLowerCase());
  }

  /**
   * Clicking a champion fills the focused slot and moves on. Clicking one
   * already in the comp removes it instead, so the grid is both the way in and
   * the way out and nothing needs a separate delete control.
   */
  protected choose(name: string): void {
    if (this.isBlocked(name)) return;

    const picks = { ...this.picks() };
    const existing = ROLES.find((role) => championOf(picks[role]).toLowerCase() === name.toLowerCase());
    if (existing) {
      picks[existing] = noteOf(picks[existing]) ? ` - ${noteOf(picks[existing])}` : '';
      this.picksChange.emit(picks);
      this.focused.set(existing);
      return;
    }

    const slot = this.focused();
    picks[slot] = setChampionInLine(picks[slot], name);
    this.picksChange.emit(picks);

    const next = nextEmptySlot(picks, slot);
    if (next) this.focused.set(next);
  }

  protected clear(role: Role): void {
    const picks = { ...this.picks() };
    const note = noteOf(picks[role]);
    picks[role] = note ? ` - ${note}` : '';
    this.picksChange.emit(picks);
    this.focused.set(role);
  }

  protected setNote(role: Role, note: string): void {
    const picks = { ...this.picks() };
    const champ = championOf(picks[role]);
    picks[role] = note.trim() ? `${champ} - ${note.trim()}` : champ;
    this.picksChange.emit(picks);
  }

  /** Dragging one slot onto another swaps them, for fixing a role mix-up. */
  protected drop(from: Role, to: Role): void {
    if (from === to) return;
    const picks = { ...this.picks() };
    const moved = picks[from];
    picks[from] = picks[to];
    picks[to] = moved;
    this.picksChange.emit(picks);
  }
}
