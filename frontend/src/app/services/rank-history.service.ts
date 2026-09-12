import { Injectable, isDevMode, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { RankHistoryDoc } from '../models/team.models';

/** A dev build reads a history pasted under this prefix before Firestore, the way the timeline override works. */
export const DEV_RANK_HISTORY_KEY = 'bom-dev-rank-history:';

/**
 * The ranks the morning refresh wrote down per player (13 Sep 2026), read when the home page's rank
 * climb comes on screen. Not a listener: five documents that change once a morning do not need one.
 * Read once a session and kept; `null` means asked and absent.
 */
@Injectable({ providedIn: 'root' })
export class RankHistoryService {
  private readonly loaded = signal<ReadonlyMap<string, RankHistoryDoc | null>>(new Map());
  private readonly inFlight = new Map<string, Promise<RankHistoryDoc | null>>();

  readonly known = this.loaded.asReadonly();

  /** Read every player's history not read yet, together. */
  async loadAll(playerIds: readonly string[]): Promise<void> {
    await Promise.all(playerIds.map((id) => this.load(id)));
  }

  async load(playerId: string): Promise<RankHistoryDoc | null> {
    const have = this.loaded().get(playerId);
    if (have !== undefined) return have;
    const pending = this.inFlight.get(playerId);
    if (pending) return pending;
    const task = this.read(playerId).then((h) => {
      this.loaded.update((map) => new Map(map).set(playerId, h));
      this.inFlight.delete(playerId);
      return h;
    });
    this.inFlight.set(playerId, task);
    return task;
  }

  private async read(playerId: string): Promise<RankHistoryDoc | null> {
    const pasted = this.devOverride(playerId);
    if (pasted) return pasted;
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return null;
    try {
      const snap = await getDoc(doc(db, 'rankHistory', playerId));
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
