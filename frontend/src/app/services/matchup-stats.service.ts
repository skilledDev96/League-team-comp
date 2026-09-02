import { Injectable, computed, inject, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { ChampionDataService } from './champion-data.service';
import { getDb } from '../core/firebase';
import { previousPatch } from './champion-stats.service';
import { Role } from '../models/team.models';

/**
 * Lane matchup win rates from solo queue at large, collected by the crawler.
 *
 * The question this finally answers is the one the draft advice panel has never
 * been able to: *given that they have taken this champion, does ours still want
 * this lane?* Our own record cannot answer it — a team has three or four games
 * against any one champion, which is no evidence at all — and the collected
 * data can, once there is enough of it.
 *
 * "Once there is enough of it" is the whole design. Nothing here waits for a
 * switch to be thrown: a pairing appears the moment it crosses the floor and is
 * absent before that, so the panel stays quiet on a thin matchup and fills in on
 * its own as the crawl deepens.
 *
 * Read from `matchupIndex`, not `matchupStats`. The raw tallies are written for
 * accumulation and run past a megabyte per lane per patch; the index is the
 * same data pruned to what is actually quotable. See `api/src/matchup-index.ts`.
 */

/** One pairing, from our champion's point of view. */
export interface MatchupRate {
  readonly games: number;
  readonly wins: number;
  readonly winRate: number;
  /** True when the previous patch was added to reach a usable sample. */
  readonly combined: boolean;
}

/**
 * Games before a matchup rate is shown at all.
 *
 * Higher than it looks like it needs to be, and deliberately so. A champion's
 * matchup win rate sits near 50%, and the 95% interval on a proportion is about
 * ±0.98/√n points: ±9.8 at a hundred games, ±6.9 at two hundred, ±4.9 at four
 * hundred. At a hundred games a 55% matchup covers everything from 45% to 65%,
 * which is not a lane read, it is a coin toss with a decimal point.
 *
 * Two hundred is the point where a genuinely lopsided matchup — the 57-58% ones
 * that a team actually wants warning about — separates from even. Weaker edges
 * than that are real but unreadable at any sample this crawl will reach inside a
 * two-week patch, and pretending otherwise is the exact failure the whole
 * advice panel exists to avoid.
 *
 * Kept on the client rather than in the rollup so it can be moved by a frontend
 * deploy; the backend prunes at a lower figure purely to keep the document
 * small.
 */
export const MIN_MATCHUP_GAMES = 200;

/**
 * Rebuild the key the crawler wrote, for a pair given in either order.
 *
 * `laneMatchups` orders the two champions by `localeCompare` on the raw names
 * and *then* strips them, so the ordering has to happen on the raw names here
 * too. Strip first and a name whose punctuation changes its sort position would
 * produce a key that exists in the document but is never looked up.
 *
 * `oursIsA` matters as much as the key. The stored `winsA` counts wins for
 * whichever champion sorted first, so reading it as ours when it is theirs
 * inverts the rate outright — a 42% hard counter would show as a 58% free lane,
 * which is worse than showing nothing by a distance.
 *
 * Takes ids, not display names: the caller resolves those, because only it has
 * the champion data to do it with.
 */
export function pairKeyFor(ourId: string, theirId: string): { key: string; oursIsA: boolean } {
  const oursIsA = ourId.localeCompare(theirId) <= 0;
  const [a, b] = oursIsA ? [ourId, theirId] : [theirId, ourId];
  const clean = (name: string) => name.replace(/[^A-Za-z0-9]/g, '');
  return { key: `${clean(a)}_${clean(b)}`, oursIsA };
}

/** Turn a stored tally into our side's rate, flipping it when we sorted second. */
export function rateFrom(
  games: number,
  winsA: number,
  oursIsA: boolean,
  combined: boolean
): MatchupRate {
  const wins = oursIsA ? winsA : games - winsA;
  return { games, wins, winRate: Math.round((wins / games) * 1000) / 10, combined };
}

/** Our role names to Riot's lane names, which is how the crawler buckets them. */
const LANE_OF: Record<Role, string> = {
  Top: 'TOP',
  Jungle: 'JUNGLE',
  Mid: 'MIDDLE',
  ADC: 'BOTTOM',
  Support: 'UTILITY'
};

interface IndexDoc {
  patch?: string;
  lane?: string;
  pairs?: Record<string, { games?: number; winsA?: number } | undefined>;
  pairsSeen?: number;
  pairsPublished?: number;
}

/** Both patches for one lane, plus whether the fetch has finished. */
interface LaneEntry {
  current: IndexDoc | null;
  prior: IndexDoc | null;
}

@Injectable({ providedIn: 'root' })
export class MatchupStatsService {
  private readonly champs = inject(ChampionDataService);

  private readonly lanes = signal<Record<string, LaneEntry>>({});
  private readonly inFlight = new Set<string>();

  /** The patch the app is on, same derivation as the champion counters. */
  readonly patch = computed(() => {
    const parts = (this.champs.version() ?? '').split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : '';
  });

  /**
   * Riot's internal champion name, letters and digits only.
   *
   * The crawler keys pairings by `championName`, which is the *id* — Wukong is
   * "MonkeyKing", Renata Glasc is "Renata". Keying off the display name here
   * would leave those champions permanently without a matchup, and the gap
   * would be invisible because a missing pairing looks exactly like one below
   * the floor. The same trap already cost the champion counters three champions.
   */
  private key(championName: string): string {
    const id = this.champs.resolveId(championName) ?? championName;
    return id.replace(/[^A-Za-z0-9]/g, '');
  }

  /** Resolve both display names to ids, then key them as the crawler did. */
  private pairKey(ours: string, theirs: string): { key: string; oursIsA: boolean } {
    return pairKeyFor(
      this.champs.resolveId(ours) ?? ours,
      this.champs.resolveId(theirs) ?? theirs
    );
  }

  private read(source: IndexDoc | null, key: string): { games: number; winsA: number } | null {
    const tally = source?.pairs?.[key];
    if (!tally) return null;
    const games = Number(tally.games);
    const winsA = Number(tally.winsA);
    if (!Number.isFinite(games) || !Number.isFinite(winsA)) return null;
    if (games <= 0 || winsA < 0 || winsA > games) return null;
    return { games, winsA };
  }

  /**
   * Our champion's record into theirs in this lane, or nothing when it is too
   * thin to quote.
   *
   * This patch alone when that clears the floor, because it is the more
   * truthful answer; otherwise both patches added, flagged so the view can say
   * which it got. A matchup rarely swings between adjacent patches, and two
   * patches of data beats none — but it is the fallback, not the default.
   */
  rate(lane: Role, ours: string, theirs: string): MatchupRate | undefined {
    if (!ours || !theirs) return undefined;
    // A mirror is 50% by construction and says nothing about either player.
    if (this.key(ours) === this.key(theirs)) return undefined;

    const entry = this.lanes()[LANE_OF[lane]];
    if (!entry) return undefined;

    const { key, oursIsA } = this.pairKey(ours, theirs);

    const current = this.read(entry.current, key);
    if (current && current.games >= MIN_MATCHUP_GAMES) {
      return rateFrom(current.games, current.winsA, oursIsA, false);
    }

    const prior = this.read(entry.prior, key);
    const games = (current?.games ?? 0) + (prior?.games ?? 0);
    const winsA = (current?.winsA ?? 0) + (prior?.winsA ?? 0);
    return games >= MIN_MATCHUP_GAMES ? rateFrom(games, winsA, oursIsA, true) : undefined;
  }

  /**
   * Fetch one lane's index, once.
   *
   * One lane at a time because that is how the documents are stored; the draft
   * room asks for all five as it opens, since the published index holds only
   * pairings past the prune floor and a lane is kilobytes rather than the
   * megabyte the raw tallies run to.
   *
   * Guarded twice — an entry already present, and one already in flight — so
   * five callers arriving together produce five fetches rather than ten, and a
   * later caller produces none. A plain `getDoc` for the same reason the
   * champion counters use one: a rate ticking over mid-draft is a distraction,
   * not an update.
   */
  async load(lane: Role): Promise<void> {
    const riotLane = LANE_OF[lane];
    const patch = this.patch();
    const db = getDb();
    if (!riotLane || !patch || !db) return;
    if (this.lanes()[riotLane] || this.inFlight.has(riotLane)) return;

    this.inFlight.add(riotLane);
    const prior = previousPatch(patch);
    try {
      const [snap, priorSnap] = await Promise.all([
        getDoc(doc(db, `matchupIndex/${patch}_${riotLane}`)),
        prior ? getDoc(doc(db, `matchupIndex/${prior}_${riotLane}`)) : Promise.resolve(null)
      ]);
      this.lanes.update((all) => ({
        ...all,
        [riotLane]: {
          current: snap.exists() ? (snap.data() as IndexDoc) : null,
          prior: priorSnap?.exists() ? (priorSnap.data() as IndexDoc) : null
        }
      }));
    } catch {
      // No matchups is a fine outcome and the common one early in a patch.
      // Recorded as an empty entry so the fetch is not retried on every render.
      this.lanes.update((all) => ({ ...all, [riotLane]: { current: null, prior: null } }));
    } finally {
      this.inFlight.delete(riotLane);
    }
  }
}
