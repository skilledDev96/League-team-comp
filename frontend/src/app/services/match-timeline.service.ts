import { Injectable, isDevMode, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { MatchTimeline } from '../models/team.models';

/**
 * The dev override's key prefix: a timeline pasted into localStorage under
 * `bom-dev-timeline:<matchId>` stands in for the Firestore document on a dev
 * build (10 Sep 2026). Part C was built while the team drafted on the live
 * site, so the function that writes version 3 documents could not be
 * deployed; a document reduced locally and pasted here lets the tape's
 * frames and wards be built and looked at on `ng serve` first. Only a dev
 * build reads it: a production bundle never takes a document off a
 * browser's storage, whatever is in there.
 */
export const DEV_TIMELINE_KEY = 'bom-dev-timeline:';

/** The localStorage key the dev override for one match lives under. */
export function devTimelineKey(matchId: string): string {
  return DEV_TIMELINE_KEY + matchId;
}

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
    // Dev builds only: a pasted document wins over Firestore and is kept as
    // loaded like one, so `forget` then `load` (what the takeover does when a
    // review lands) and a page reload both pick up a fresh paste.
    const override = this.devOverride(matchId);
    if (override) {
      this.loaded.update((map) => new Map(map).set(matchId, override));
      return override;
    }
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

  /**
   * The pasted document for this match, on a dev build with one in storage
   * that parses to an object carrying the same `matchId`; null otherwise. A
   * value that is there but wrong (not JSON, not an object, another match's)
   * is ignored with one warning, so a stale paste never masquerades as the
   * real document and never breaks the read.
   */
  private devOverride(matchId: string): MatchTimeline | null {
    if (!this.isDev()) return null;
    let raw: string | null;
    try {
      raw = localStorage.getItem(devTimelineKey(matchId));
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { matchId?: unknown }).matchId === matchId) {
        return parsed as MatchTimeline;
      }
    } catch {
      // Not JSON: the warning below says so.
    }
    console.warn(`Ignoring ${devTimelineKey(matchId)}: not a timeline document for ${matchId}`);
    return null;
  }

  /** `isDevMode()` behind a method, so a spec can stand in a production build. */
  protected isDev(): boolean {
    return isDevMode();
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
