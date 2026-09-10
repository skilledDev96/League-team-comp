import { Injectable, isDevMode, signal } from '@angular/core';
import { doc, Firestore, getDoc } from 'firebase/firestore';
import { getDb, isFirebaseConfigured } from '../core/firebase';
import { ReplayRecording, ReplayShot } from '../models/team.models';

/** What an `<img>` takes: the stored base64 with the `data:` prefix the document deliberately leaves off. */
export function shotSrc(shot: ReplayShot): string {
  return `data:${shot.mediaType};base64,${shot.data}`;
}

/**
 * The dev override's key prefixes, the same road `MatchTimelineService` opened
 * for a version 3 timeline (10 Sep 2026): a recording pasted into
 * localStorage under `bom-dev-recording:<matchId>`, and a picture under
 * `bom-dev-shot:<docId>`, stand in for the Firestore documents on a dev
 * build. The recorder is a local script and the collections may not exist on
 * the live site yet, so this is the only way to look at the strip and the
 * drawer on `ng serve` before anything is uploaded. A picture is a few
 * hundred kilobytes of base64, so paste one or two, not twenty.
 *
 * Only a dev build reads them: a production bundle never takes a document
 * off a browser's storage, whatever is in there.
 */
export const DEV_RECORDING_KEY = 'bom-dev-recording:';

/** The one for a picture, keyed by its `replayShots` document id. */
export const DEV_SHOT_KEY = 'bom-dev-shot:';

export function devRecordingKey(matchId: string): string {
  return DEV_RECORDING_KEY + matchId;
}

export function devShotKey(docId: string): string {
  return DEV_SHOT_KEY + docId;
}

/**
 * The recording for one game, and its pictures, read when something asks
 * (10 Sep 2026).
 *
 * A tournament or scrim game is invisible to Riot's API, so the local
 * recorder walks the replay in the League client and writes
 * `replayRecordings/{matchId}` with one picture a document at
 * `replayShots/{matchId}__{sec}`. This reads them.
 *
 * The same shape as `MatchTimelineService` and for the same reason: a
 * `getDoc` when a row asks, never a collection listener. A recording is a few
 * kilobytes but each of its pictures is a few hundred, so the two are
 * separate reads - the frames strip loads a picture when it scrolls into view
 * or is tapped, and never twenty at once. Both are kept for the session: a
 * recording is written once by the recorder and does not change until it is
 * recorded again.
 */
@Injectable({ providedIn: 'root' })
export class ReplayRecordingService {
  private readonly loaded = signal<ReadonlyMap<string, ReplayRecording | null>>(new Map());
  private readonly inFlight = new Map<string, Promise<ReplayRecording | null>>();

  private readonly shots = signal<ReadonlyMap<string, ReplayShot | null>>(new Map());
  private readonly shotsInFlight = new Map<string, Promise<ReplayShot | null>>();

  /** What has been read so far; `null` means asked and absent. */
  readonly known = this.loaded.asReadonly();

  /** The pictures read so far, by document id; `null` means asked and absent. */
  readonly knownShots = this.shots.asReadonly();

  /** The recording for a game, once something has asked for it; `undefined` while nobody has. */
  recordingFor(matchId: string | undefined): ReplayRecording | null | undefined {
    return matchId ? this.known().get(matchId) : undefined;
  }

  /** True once a read has come back with a recording: what the Games row's chip stands on. */
  has(matchId: string | undefined): boolean {
    return !!this.recordingFor(matchId);
  }

  async load(matchId: string): Promise<ReplayRecording | null> {
    const have = this.loaded().get(matchId);
    if (have !== undefined) return have;
    // Dev builds only: a pasted recording wins over Firestore and is kept as
    // loaded like one, so a reload and a `forget` both pick up a fresh paste.
    const pasted = this.devDoc<ReplayRecording>(devRecordingKey(matchId), (d) => d['matchId'] === matchId);
    if (pasted) {
      this.loaded.update((map) => new Map(map).set(matchId, pasted));
      return pasted;
    }
    const pending = this.inFlight.get(matchId);
    if (pending) return pending;
    const task = this.read('replayRecordings', matchId, (d) => d as ReplayRecording).then((rec) => {
      this.loaded.update((map) => new Map(map).set(matchId, rec));
      this.inFlight.delete(matchId);
      return rec;
    });
    this.inFlight.set(matchId, task);
    return task;
  }

  /** One picture, by the document id the recording's shot carries. */
  async loadShot(docId: string): Promise<ReplayShot | null> {
    const have = this.shots().get(docId);
    if (have !== undefined) return have;
    const pasted = this.devDoc<ReplayShot>(devShotKey(docId), (d) => typeof d['data'] === 'string' && typeof d['mediaType'] === 'string');
    if (pasted) {
      this.shots.update((map) => new Map(map).set(docId, pasted));
      return pasted;
    }
    const pending = this.shotsInFlight.get(docId);
    if (pending) return pending;
    const task = this.read('replayShots', docId, (d) => d as ReplayShot).then((shot) => {
      this.shots.update((map) => new Map(map).set(docId, shot));
      this.shotsInFlight.delete(docId);
      return shot;
    });
    this.shotsInFlight.set(docId, task);
    return task;
  }

  /** The picture, if it has been read; `undefined` while nobody has asked for it. */
  shotFor(docId: string): ReplayShot | null | undefined {
    return this.knownShots().get(docId);
  }

  /** Drop a stale read, so a game recorded again is picked up. */
  forget(matchId: string): void {
    this.loaded.update((map) => {
      const next = new Map(map);
      next.delete(matchId);
      return next;
    });
  }

  /** The database, or null in local mode where there is none; behind a method so a spec can stand in for it. */
  protected db(): Firestore | null {
    return isFirebaseConfigured() ? getDb() : null;
  }

  /** `isDevMode()` behind a method, so a spec can stand in a production build. */
  protected isDev(): boolean {
    return isDevMode();
  }

  /**
   * The document pasted under this key, on a dev build, when it parses to an
   * object the check accepts; null otherwise. A value that is there but wrong
   * (not JSON, not an object, another game's) is ignored with one warning, so
   * a stale paste never masquerades as the real document and never breaks the
   * read — the Firestore road runs after it either way.
   */
  private devDoc<T>(key: string, ok: (parsed: Record<string, unknown>) => boolean): T | null {
    if (!this.isDev()) return null;
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ok(parsed as Record<string, unknown>)) return parsed as T;
    } catch {
      // Not JSON: the warning below says so.
    }
    console.warn(`Ignoring ${key}: not the document it should be`);
    return null;
  }

  private async read<T>(collection: string, id: string, shape: (data: unknown) => T): Promise<T | null> {
    const db = this.db();
    if (!db) return null;
    try {
      const snap = await getDoc(doc(db, collection, id));
      return snap.exists() ? shape(snap.data()) : null;
    } catch {
      return null;
    }
  }
}
