import { inject, Injectable } from '@angular/core';
import { ExpectAxis } from '../../core/comp-expectation';
import { Comp, CompExpectation, CompOutcome, CompPicks, CompResult, ExpectLevel, Play, ROLES } from '../../models/team.models';
import { CompExpectationService } from '../../services/comp-expectation.service';
import { TeamDataService } from '../../services/team-data.service';
import { ToastService } from '../../services/toast.service';

/** A result being typed into the log form. */
export interface ResultDraft {
  outcome: CompOutcome;
  opponent: string;
  note: string;
  playedOn: string;
}

/** The comp's words, as the sheet's fields hold them before a save trims them. */
export interface CompWords {
  category: string;
  notes: string;
  early: string;
  mid: string;
  late: string;
  bans: readonly string[];
}

/** What goes with a comp when it is deleted; the confirm names it first. */
export interface CompCascade {
  results: readonly CompResult[];
  plays: readonly Play[];
  /** The comps that count under it; they stand on their own afterwards. */
  variants: readonly Comp[];
}

/** How long one "Saved" stands for a comp, however many writes land in it. */
const SAVED_EVERY_MS = 2000;

/**
 * Every write the Comps page makes (13 Sep 2026), in one place: each one stamps the comp's expectation through
 * `CompExpectationService.stamped` so the review function always finds one — adding a comp used to be the one path
 * that did not — and each one ends in the same quiet "Saved <name>", at most once every couple of seconds per comp,
 * so a rename, a pick and a note in quick succession read as one save.
 *
 * Provided on the page, not the root: the throttle is the page's.
 */
@Injectable()
export class CompWritesService {
  private readonly data = inject(TeamDataService);
  private readonly expectations = inject(CompExpectationService);
  private readonly toast = inject(ToastService);
  private readonly savedAt = new Map<string, number>();

  /** A blank comp, "New comp N", its five seats empty; the id, so the page can open it. */
  async add(): Promise<string> {
    const name = `New comp ${this.data.comps().length + 1}`;
    const picks = Object.fromEntries(ROLES.map((r) => [r, ''])) as CompPicks;
    const { id: _id, order: _order, ...fresh } = this.stamp({ id: '', order: 0, name, picks });
    const id = await this.data.createComp(fresh);
    this.saved({ id, name });
    return id;
  }

  /** The name, trimmed. Unchanged writes nothing; empty writes nothing and says so, so the field can revert. */
  async rename(comp: Comp, raw: string): Promise<'saved' | 'unchanged' | 'empty'> {
    const name = raw.trim();
    if (!name) return 'empty';
    if (name === comp.name) return 'unchanged';
    await this.data.updateComp(this.stamp({ ...comp, name }));
    this.saved({ id: comp.id, name });
    return 'saved';
  }

  /** The board emits the whole picks object; a pick lands as soon as it is clicked. */
  async savePicks(comp: Comp, picks: CompPicks): Promise<void> {
    await this.data.updateComp(this.stamp({ ...comp, picks }));
    this.saved(comp);
  }

  /** Category, notes, the game plan and the bans, trimmed; nothing is written when none of them changed. */
  async saveWords(comp: Comp, w: CompWords): Promise<boolean> {
    const category = w.category.trim();
    const notes = w.notes.trim();
    const early = w.early.trim();
    const mid = w.mid.trim();
    const late = w.late.trim();
    const bans = w.bans.map((b) => b.trim()).filter(Boolean);
    const gamePlan = early || mid || late ? { ...(early && { early }), ...(mid && { mid }), ...(late && { late }) } : undefined;
    const unchanged =
      (category || undefined) === comp.category &&
      (notes || undefined) === comp.notes &&
      (early || undefined) === comp.gamePlan?.early &&
      (mid || undefined) === comp.gamePlan?.mid &&
      (late || undefined) === comp.gamePlan?.late &&
      bans.join('|') === (comp.bans ?? []).join('|');
    if (unchanged) return false;
    await this.data.updateComp(this.stamp({ ...comp, category: category || undefined, notes: notes || undefined, gamePlan, bans: bans.length ? bans : undefined }));
    this.saved(comp);
    return true;
  }

  async setExpectation(comp: Comp, axis: ExpectAxis, level: ExpectLevel, current: CompExpectation): Promise<void> {
    if (current[axis] === level && comp.expectSource === 'edited') return;
    await this.data.updateComp({ ...comp, expect: { ...current, [axis]: level }, expectSource: 'edited' });
    this.saved(comp);
  }

  /** Drop what was set by hand and read the four axes off the champions again. */
  async resetExpectation(comp: Comp): Promise<void> {
    await this.data.updateComp({ ...comp, expect: this.expectations.derived(comp) ?? undefined, expectSource: 'derived' });
    this.saved(comp);
  }

  async setCountsUnder(comp: Comp, value: string): Promise<void> {
    const countsUnder = value || null;
    if ((comp.countsUnder ?? null) === countsUnder) return;
    await this.data.updateComp(this.stamp({ ...comp, countsUnder }));
    this.saved(comp);
  }

  async logResult(comp: Comp, draft: ResultDraft): Promise<void> {
    await this.data.createCompResult({
      compId: comp.id,
      outcome: draft.outcome,
      opponent: draft.opponent.trim() || undefined,
      note: draft.note.trim() || undefined,
      playedOn: draft.playedOn || today()
    });
    this.saved(comp);
  }

  async deleteResult(result: CompResult): Promise<void> {
    await this.data.deleteCompResult(result.id);
  }

  /**
   * The comp and everything hanging off it: its logged results and its plays go, and a comp that counted under
   * it stands on its own. The caller has confirmed, naming all of that.
   */
  async remove(comp: Comp, c: CompCascade): Promise<void> {
    for (const r of c.results) await this.data.deleteCompResult(r.id);
    for (const p of c.plays) await this.data.deletePlay(p.id);
    for (const v of c.variants) await this.data.updateComp({ ...v, countsUnder: null });
    await this.data.deleteComp(comp.id);
    this.toast.show(`Deleted ${comp.name}`, { kind: 'ok', timeout: 1800 });
  }

  blankDraft(): ResultDraft {
    return { outcome: 'win', opponent: '', note: '', playedOn: today() };
  }

  /** The comp with its derived expectation on it, unless a person set one. */
  private stamp(comp: Comp): Comp {
    return this.expectations.stamped(comp);
  }

  private saved(comp: { id: string; name: string }): void {
    const last = this.savedAt.get(comp.id) ?? 0;
    if (Date.now() - last < SAVED_EVERY_MS) return;
    this.savedAt.set(comp.id, Date.now());
    this.toast.show(`Saved ${comp.name}`, { kind: 'ok', timeout: 1800 });
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
