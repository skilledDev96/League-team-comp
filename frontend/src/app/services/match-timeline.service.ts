import { Injectable, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { MatchTimeline } from '../models/team.models';

/**
 * The derived timeline for one game, read when a row asks for it.
 *
 * Not a collection listener on purpose: two hundred documents of ten
 * kilobytes each on every page load is the wrong trade for something only an
 * opened row reads. Read once, kept for the session; a timeline is derived
 * from a finished game and does not change until the version does.
 */
@Injectable({ providedIn: 'root' })
export class MatchTimelineService {
  private readonly loaded = signal<ReadonlyMap<string, MatchTimeline | null>>(new Map());
  private readonly inFlight = new Map<string, Promise<MatchTimeline | null>>();

  /** What has been read so far; `null` means asked and absent. */
  readonly known = this.loaded.asReadonly();

  async load(matchId: string): Promise<MatchTimeline | null> {
    const have = this.loaded().get(matchId);
    if (have !== undefined) return have;
    const pending = this.inFlight.get(matchId);
    if (pending) return pending;
    const task = this.read(matchId).then((t) => {
      this.loaded.update((map) => new Map(map).set(matchId, t));
      this.inFlight.delete(matchId);
      return t;
    });
    this.inFlight.set(matchId, task);
    return task;
  }

  /** Drop a stale read so a fresh document is picked up, after a review fetched one. */
  forget(matchId: string): void {
    this.loaded.update((map) => {
      const next = new Map(map);
      next.delete(matchId);
      return next;
    });
  }

  private async read(matchId: string): Promise<MatchTimeline | null> {
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return null;
    try {
      const snap = await getDoc(doc(db, 'matchTimeline', matchId));
      return snap.exists() ? (snap.data() as MatchTimeline) : null;
    } catch {
      return null;
    }
  }
}
