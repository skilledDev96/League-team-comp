import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionGridComponent } from './champion-grid.component';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
import { ChampionTraits, CompFallbacks, CompPicks, DamageType, Role, ROLES } from '../models/team.models';
import { TeamDataService } from '../services/team-data.service';
import { classifyComp, damageProfile, IDENTITY_LABEL } from '../core/comp-identity';
import {
  addOption,
  compSeatOptions,
  CompSeats,
  MAX_SEAT_OPTIONS,
  promoteOption,
  removeOption,
  seatOf,
  SeatWrite,
  setNote,
  setPriority,
  swapSeats
} from '../core/comp-seats';
import {
  championOf,
  championsInComp,
  indexTraits,
  nextEmptySlot,
  noteOf,
  traitsFor
} from './comp-board.util';
import { TooltipDirective } from './tooltip.directive';

/** What the wall's next click does: set the focused seat's priority, or add one more fallback to it. */
type Aim = 'priority' | 'fallback';

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
 *
 * **A seat holds more than one champion since 20 Sep 2026** (the lead: "the dive comp has naut a
 * priority but Leona can also be added as a secondary pick"). The priority is drawn as it always was;
 * the fallbacks sit under it as chips. Pressing a seat still aims the wall at its priority — today's
 * behaviour, unchanged — and the seat's own "Add a fallback" pill aims at its fallbacks instead, where
 * a click appends and focus stays, so three fallbacks are three clicks. Every gesture emits **both**
 * fields through one `change` output (`core/comp-seats.ts` builds them), so one gesture is one write
 * and the two cannot drift.
 */
@Component({
  selector: 'app-comp-board',
  imports: [FormsModule, ChampionGridComponent, TooltipDirective],
  templateUrl: './comp-board.component.html'
})
export class CompBoardComponent implements OnInit {
  protected readonly champs = inject(ChampionDataService);
  protected readonly ui = inject(UiService);
  private readonly data = inject(TeamDataService);

  readonly picks = input.required<CompPicks>();
  /** Each seat's fallbacks behind its priority. Absent on every comp stored before 20 Sep 2026. */
  readonly fallbacks = input<CompFallbacks | undefined>(undefined);
  /** Champions unavailable here — burned in a fearless series, or already banned. */
  readonly unavailable = input<readonly string[]>([]);
  /** One gesture, one write: the seats' two fields always leave together. */
  readonly change = output<{ picks: CompPicks; fallbacks?: CompFallbacks }>();

  protected readonly roles = ROLES;
  protected readonly maxOptions = MAX_SEAT_OPTIONS;

  /** The two stored fields as one thing, which is all `core/comp-seats.ts` ever wants. */
  protected readonly seats = computed<CompSeats>(() => ({ picks: this.picks(), fallbacks: this.fallbacks() }));

  /** Every seat's options, normalised once per change, so no two places count a seat differently. */
  protected readonly options = computed(() => compSeatOptions(this.seats()));

  /**
   * Starts on the first empty slot, not on Top.
   *
   * Defaulting to Top meant opening a half-built comp and having the first
   * click silently overwrite the top laner — the one slot most likely to be
   * already filled. Aiming at the gap is what someone opening a comp intends.
   */
  protected readonly focused = signal<Role>('Top');

  /**
   * Whether the next wall click fills the focused seat or adds a fallback to it.
   *
   * Never silent: the line above the wall says which it is and how many the seat already holds, because
   * a click that appends where the reader expected a replacement is exactly the kind of thing nobody
   * notices until a comp is wrong.
   */
  protected readonly aimAt = signal<Aim>('priority');

  /**
   * The wall shows while there is somewhere to put a champion (12 Sep 2026). A finished comp opens
   * on its five seats; pressing a seat, or Change picks, brings the wall back aimed at that seat,
   * and it goes again once all five are in. Swapping a pick was already "press the seat, press the
   * champion", so no click was added — but a finished comp no longer draws about 170 champions
   * under it for somebody who opened it to read the plan.
   *
   * A finished comp is exactly when fallbacks get added, so each seat's own "Add a fallback" pill
   * opens the wall too (20 Sep 2026) — and a fallback click never closes it, however complete the five.
   */
  protected readonly gridWanted = signal(false);
  protected readonly complete = computed(() => ROLES.every((role) => !!championOf(this.picks()[role])));
  protected readonly gridShown = computed(() => this.gridWanted() || !this.complete());

  /** Press a seat: the wall fills that seat's priority, as it always has. */
  protected aim(role: Role): void {
    this.focused.set(role);
    this.aimAt.set('priority');
    this.gridWanted.set(true);
  }

  /** The seat's own pill: the wall appends fallbacks to this seat until something else is pressed. */
  protected aimFallback(role: Role): void {
    this.focused.set(role);
    this.aimAt.set('fallback');
    this.gridWanted.set(true);
  }

  ngOnInit(): void {
    const firstEmpty = ROLES.find((role) => !championOf(this.picks()[role]));
    if (firstEmpty) this.focused.set(firstEmpty);
  }

  protected readonly championOf = championOf;
  protected readonly noteOf = noteOf;

  protected readonly taken = computed(() => championsInComp(this.seats()));

  /** The seat's fallbacks alone — the priority is drawn above them. */
  protected fallbacksOf(role: Role) {
    return this.options()[role].slice(1);
  }

  protected atLimit(role: Role): boolean {
    return this.options()[role].length >= MAX_SEAT_OPTIONS;
  }

  /** Traits re-keyed once per change, so every slot reads the same index. */
  private readonly traitIndex = computed(() => indexTraits(this.data.championTraits()));

  /**
   * Traits for the five picked champions, joined on the Data Dragon id rather
   * than the display name — "Wukong" and "MonkeyKing" are the same champion and
   * only one of them is a key.
   *
   * The **priority** five, deliberately: a comp's identity, its damage profile and its expectation are
   * what it plays, and a fallback is what it plays instead.
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
   *
   * What "removes it" means since 20 Sep 2026: that **entry**, priority or fallback, and never the
   * whole seat. Removing a priority promotes the seat's first fallback, so a seat never reads Empty
   * with chips under it.
   */
  protected choose(name: string): void {
    // No blocked check here: the grid refuses an unavailable champion before it
    // ever emits, so anything arriving has already been cleared.
    const seats = this.seats();
    const held = seatOf(seats, name);
    if (held) {
      const write = removeOption(seats, held, name);
      this.emit(write);
      // The aim follows a removal only when the removal actually **emptied** the seat, which is the
      // old gesture: take a champion off and the next click refills the hole. A seat that still holds
      // a champion — a fallback taken off, or a priority whose fallback was promoted — is not a hole,
      // so the wall stays where the reader put it (20 Sep 2026). Moving the aim there anyway pointed
      // the next click at a filled seat's priority, and the champion sitting in it was replaced by a
      // click nobody meant that way; leaving it on 'fallback' over an emptied seat made the line above
      // the wall describe an append where the next click in fact sets the priority.
      if (!championOf(write.picks[held])) {
        this.focused.set(held);
        this.aimAt.set('priority');
      }
      return;
    }

    const slot = this.focused();
    // A seat with nothing in it takes the priority branch whatever the aim says: `addOption` makes an
    // empty seat's first champion the priority anyway, and coming through here would neither advance
    // focus nor close a finished comp's wall, which every other priority fill does.
    if (this.aimAt() === 'fallback' && this.options()[slot].length) {
      if (this.atLimit(slot)) return; // The line above the wall already says the seat is full.
      this.emit(addOption(seats, slot, name));
      return; // Focus and aim stay put: three fallbacks are three clicks.
    }

    const write = setPriority(seats, slot, name);
    this.emit(write);

    const next = nextEmptySlot(write.picks, slot);
    if (next) this.focused.set(next);
    else this.gridWanted.set(false);
  }

  /**
   * The seat's ×. Clearing a priority promotes the first fallback rather than emptying the seat; with
   * no fallbacks it clears exactly as it always did, note kept.
   */
  protected clear(role: Role): void {
    const champ = championOf(this.picks()[role]);
    if (!champ) return;
    this.emit(removeOption(this.seats(), role, champ));
    this.focused.set(role);
    this.aimAt.set('priority');
  }

  /** A chip's ×: that one fallback goes, the rest keep their order. */
  protected removeFallback(role: Role, champion: string): void {
    this.emit(removeOption(this.seats(), role, champion));
  }

  /** A chip's body: that fallback becomes the priority and the old priority drops in behind it. */
  protected promote(role: Role, champion: string): void {
    this.emit(promoteOption(this.seats(), role, champion));
  }

  /**
   * The note field edits the seat's **priority**.
   *
   * A fallback's note is shown as its chip's tip and is not edited here: the chip's body already
   * promotes, which is the one gesture it has, and a second field per chip would put four inputs in a
   * 9rem column. Promote a fallback and the field is its note.
   */
  protected setNote(role: Role, note: string): void {
    this.emit(setNote(this.seats(), role, championOf(this.picks()[role]), note));
  }

  /**
   * Dragging one slot onto another swaps them, for fixing a role mix-up — fallbacks and notes with them.
   *
   * A slot accepts any drop, so `from` is whatever the drag was carrying: a champion's picture out of
   * the wall is natively draggable and hands over its icon URL (20 Sep 2026). Only a seat is a swap;
   * anything else leaves the comp alone rather than emitting a write that changes nothing.
   */
  protected drop(from: Role, to: Role): void {
    if (from === to || !ROLES.includes(from) || !ROLES.includes(to)) return;
    this.emit(swapSeats(this.seats(), from, to));
  }

  /** An empty `fallbacks` is emitted as nothing at all, so the stored comp keeps no noise. */
  private emit(write: SeatWrite): void {
    const fallbacks = Object.keys(write.fallbacks).length ? write.fallbacks : undefined;
    this.change.emit({ picks: write.picks, fallbacks });
  }
}
