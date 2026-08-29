import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionGridComponent } from './champion-grid.component';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
import { ChampionTraits, CompPicks, DamageType, Role, ROLES } from '../models/team.models';
import { TeamDataService } from '../services/team-data.service';
import { classifyComp, damageProfile, IDENTITY_LABEL } from '../core/comp-identity';
import {
  championOf,
  championsInComp,
  indexTraits,
  nextEmptySlot,
  noteOf,
  setChampionInLine,
  traitsFor
} from './comp-board.util';

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
  imports: [FormsModule, ChampionGridComponent],
  templateUrl: './comp-board.component.html'
})
export class CompBoardComponent implements OnInit {
  protected readonly champs = inject(ChampionDataService);
  protected readonly ui = inject(UiService);
  private readonly data = inject(TeamDataService);

  readonly picks = input.required<CompPicks>();
  /** Champions unavailable here — burned in a fearless series, or already banned. */
  readonly unavailable = input<readonly string[]>([]);
  readonly picksChange = output<CompPicks>();

  protected readonly roles = ROLES;

  /**
   * Starts on the first empty slot, not on Top.
   *
   * Defaulting to Top meant opening a half-built comp and having the first
   * click silently overwrite the top laner — the one slot most likely to be
   * already filled. Aiming at the gap is what someone opening a comp intends.
   */
  protected readonly focused = signal<Role>('Top');

  ngOnInit(): void {
    const firstEmpty = ROLES.find((role) => !championOf(this.picks()[role]));
    if (firstEmpty) this.focused.set(firstEmpty);
  }

  protected readonly championOf = championOf;
  protected readonly noteOf = noteOf;

  protected readonly taken = computed(() => championsInComp(this.picks()));

  /** Traits re-keyed once per change, so every slot reads the same index. */
  private readonly traitIndex = computed(() => indexTraits(this.data.championTraits()));

  /**
   * Traits for the five picked champions, joined on the Data Dragon id rather
   * than the display name — "Wukong" and "MonkeyKing" are the same champion and
   * only one of them is a key.
   */
  private readonly compTraits = computed(() => {
    const index = this.traitIndex();
    const out: ChampionTraits[] = [];
    for (const role of ROLES) {
      const name = championOf(this.picks()[role]);
      if (!name) continue;
      const traits = traitsFor(index, this.champs.resolve(name)?.id);
      if (traits) out.push(traits);
    }
    return out;
  });

  /** The comp's shape, once all five are in. Blank while it is being built. */
  protected readonly identity = computed(() => {
    const traits = this.compTraits();
    if (traits.length < 5) return null;
    return IDENTITY_LABEL[classifyComp(traits)];
  });

  protected readonly damage = computed(() => damageProfile(this.compTraits()));

  /** Per-slot damage type, for the dot on a filled slot. */
  protected damageOf(role: Role): DamageType | null {
    const name = championOf(this.picks()[role]);
    if (!name) return null;
    return traitsFor(this.traitIndex(), this.champs.resolve(name)?.id)?.damage ?? null;
  }

  /**
   * Clicking a champion fills the focused slot and moves on. Clicking one
   * already in the comp removes it instead, so the grid is both the way in and
   * the way out and nothing needs a separate delete control.
   */
  protected choose(name: string): void {
    // No blocked check here: the grid refuses an unavailable champion before it
    // ever emits, so anything arriving has already been cleared.
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
