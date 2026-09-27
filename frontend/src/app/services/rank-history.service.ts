import { Injectable, inject, isDevMode, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { scopedPath } from '../core/team-scope';
import { RankHistoryDoc } from '../models/team.models';
import { resetOnTeamChange, TeamScopeService } from './team-scope.service';

/** A dev build reads a history pasted under this prefix before Firestore, the way the timeline override works. */
export const DEV_RANK_HISTORY_KEY = 'bom-dev-rank-history:';

/**
 * The ranks the morning refresh wrote down per player (13 Sep 2026), read when the home page's rank
 * climb comes on screen. Not a listener: five documents that change once a morning do not need one.
 * Read once a session and kept; `null` means asked and absent.
 *
 * The document is the active team's (27 Sep 2026, release 2): `rankHistory/{playerId}` for Bom Squad
 * on the root, byte for byte the path it always was, and `teams/{id}/rankHistory/{playerId}` for any
 * other team. Player ids are one team's, so a switch empties what was read; the dev paste stays keyed
 * by player id alone.
 */
@Injectable({ providedIn: 'root' })
export class RankHistoryService {
  private readonly scope = inject(TeamScopeService);
  private readonly loaded = signal<ReadonlyMap<string, RankHistoryDoc | null>>(new Map());
  private readonly inFlight = new Map<string, Promise<RankHistoryDoc | null>>();
  /** Bumped by a reset, so a read still in flight for the previous team lands nowhere. */
  private generation = 0;

  readonly known = this.loaded.asReadonly();

  constructor() {
    resetOnTeamChange(() => this.reset());
  }

  /** Read every player's history not read yet, together. */
  async loadAll(playerIds: readonly string[]): Promise<void> {
    await Promise.all(playerIds.map((id) => this.load(id)));
  }

  async load(playerId: string): Promise<RankHistoryDoc | null> {
    const have = this.loaded().get(playerId);
    if (have !== undefined) return have;
    // Dev builds only: a pasted history wins over Firestore and is kept as loaded like one.
    const pasted = this.devOverride(playerId);
    if (pasted) {
      this.loaded.update((map) => new Map(map).set(playerId, pasted));
      return pasted;
    }
    const pending = this.inFlight.get(playerId);
    if (pending) return pending;
    const generation = this.generation;
    const task = this.read(this.path(playerId)).then((h) => {
      // A read that was in flight when the team changed is the previous team's: it stays off the map.
      if (generation !== this.generation) return h;
      this.loaded.update((map) => new Map(map).set(playerId, h));
      this.inFlight.delete(playerId);
      return h;
    });
    this.inFlight.set(playerId, task);
    return task;
  }

  /** The document's path for the active team. */
  private path(playerId: string): string {
    return scopedPath(this.scope.activeTeamId(), 'rankHistory', playerId);
  }

  private reset(): void {
    this.generation++;
    this.inFlight.clear();
    this.loaded.set(new Map());
  }

  /** One document read at this path, behind a method so a spec can stand in for Firestore. */
  protected async read(path: string): Promise<RankHistoryDoc | null> {
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return null;
    try {
      const snap = await getDoc(doc(db, path));
      return snap.exists() ? (snap.data() as RankHistoryDoc) : null;
    } catch {
      return null;
    }
  }

  private devOverride(playerId: string): RankHistoryDoc | null {
    if (!isDevMode()) return null;
    try {
      const raw = localStorage.getItem(DEV_RANK_HISTORY_KEY + playerId);
      const parsed = raw ? (JSON.parse(raw) as RankHistoryDoc) : null;
      return parsed && Array.isArray(parsed.points) ? parsed : null;
    } catch {
      return null;
    }
  }
}
