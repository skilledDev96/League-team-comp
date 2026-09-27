import { Injectable, inject, isDevMode, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { scopedPath } from '../core/team-scope';
import { MatchTimeline } from '../models/team.models';
import { resetOnTeamChange, TeamScopeService } from './team-scope.service';

/**
 * The dev override's key prefix: a timeline pasted into localStorage under
 * `bom-dev-timeline:<matchId>` stands in for the Firestore document on a dev
 * build (10 Sep 2026). Part C was built while the team drafted on the live
 * site, so the function that writes the newest documents could not be
 * deployed; a document reduced locally and pasted here lets the tape's
 * frames and wards be built and looked at on `ng serve` first. The same road
 * serves version 4 (11 Sep 2026), which adds the kill and monster events'
 * own positions: until the functions go out, a film reads whatever version
 * its stored document was written at and says on the square how its deaths
 * were placed. Only a dev
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
 *
 * The document is the active team's (27 Sep 2026, release 2):
 * `matchTimeline/{matchId}` for Bom Squad on the root, byte for byte the
 * path it always was, and `teams/{id}/matchTimeline/{matchId}` for any other
 * team. A timeline is built from one team's side of a game, so two teams in
 * one custom game are two documents under one match id, and a switch empties
 * what was read. The dev paste stays keyed by match id alone.
 */
@Injectable({ providedIn: 'root' })
export class MatchTimelineService {
  private readonly scope = inject(TeamScopeService);
  private readonly loaded = signal<ReadonlyMap<string, MatchTimeline | null>>(new Map());
  private readonly inFlight = new Map<string, Promise<MatchTimeline | null>>();
  /** Bumped by a reset, so a read still in flight for the previous team lands nowhere. */
  private generation = 0;

  /** What has been read so far; `null` means asked and absent. */
  readonly known = this.loaded.asReadonly();

  constructor() {
    resetOnTeamChange(() => this.reset());
  }

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
    const generation = this.generation;
    const task = this.read(this.path(matchId)).then((t) => {
      // A read that was in flight when the team changed is the previous team's: it stays off the map.
      if (generation !== this.generation) return t;
      this.loaded.update((map) => new Map(map).set(matchId, t));
      this.inFlight.delete(matchId);
      return t;
    });
    this.inFlight.set(matchId, task);
    return task;
  }

  /** The document's path for the active team. */
  private path(matchId: string): string {
    return scopedPath(this.scope.activeTeamId(), 'matchTimeline', matchId);
  }

  private reset(): void {
    this.generation++;
    this.inFlight.clear();
    this.loaded.set(new Map());
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

  /** One document read at this path, behind a method so a spec can stand in for Firestore. */
  protected async read(path: string): Promise<MatchTimeline | null> {
    const db = isFirebaseConfigured() ? getDb() : null;
    if (!db) return null;
    try {
      const snap = await getDoc(doc(db, path));
      return snap.exists() ? (snap.data() as MatchTimeline) : null;
    } catch {
      return null;
    }
  }
}
