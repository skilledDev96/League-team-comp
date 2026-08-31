import { Injectable, computed, inject, signal } from '@angular/core';
import { doc, getDoc } from 'firebase/firestore';
import { ChampionDataService } from './champion-data.service';
import { getDb } from '../core/firebase';

/**
 * Champion win rates from solo queue at large, collected by the crawler.
 *
 * This is the number the team has never had. Their own comp record answers
 * "how has this gone for us" over tens of games; this answers "how does this
 * champion do at all" over tens of thousands. Neither replaces the other —
 * a 100% from one game and a 51% from forty thousand say different things, and
 * the point of showing them side by side is that the gap between them is
 * usually the interesting part.
 *
 * Read-only here. Collection happens in `api/src/crawler.ts`, and the counters
 * hold no player data — champion totals per patch, nothing else.
 */

/** One champion's record in solo queue, as collected. */
export interface ChampionRate {
  readonly games: number;
  readonly wins: number;
  readonly winRate: number;
  /** True when the previous patch had to be included to reach a usable sample. */
  readonly combined: boolean;
}

/**
 * The patch before this one — "16.17" -> "16.16".
 *
 * Needed because a fourteen-day collection window reaches back across a patch
 * boundary, so for most of a patch's life the majority of what is collected
 * describes the *previous* one. Reading only the current bucket threw that away
 * and made a usable sample take three times as long to arrive.
 *
 * Nothing sensible exists before the first patch of a season, so it stops there
 * rather than inventing "16.0".
 */
export function previousPatch(patch: string): string {
  const [major, minor] = patch.split('.');
  const n = Number(minor);
  return major && Number.isFinite(n) && n > 1 ? `${major}.${n - 1}` : '';
}

/**
 * Games before a rate is quoted at all.
 *
 * A champion's true win rate sits near 50%, so at 400 games the interval is
 * about ±5 points — wide, but narrow enough that 44% and 54% are telling you
 * something different. Below it the number would be noise wearing a decimal
 * point, which is the exact mistake the whole advice panel exists to avoid.
 */
export const MIN_RATE_GAMES = 400;

interface StatsDoc {
  patch?: string;
  matches?: number;
  champions?: Record<string, { games?: number; wins?: number }>;
  /** Older buckets carry literal dotted field names; see `readCounters`. */
  [flatKey: string]: unknown;
}

/**
 * Pull champion counters out of a bucket, in either shape it may be stored in.
 *
 * The crawler's first days wrote `set({'champions.Ahri.games': …})`, and
 * `set()` does not read a dotted key as a field path — only `update()` does —
 * so those became *literal field names containing dots* and no `champions` map
 * existed at all. The write is fixed, but a patch bucket already part-filled
 * that way still holds real games, and dropping them to keep the reader tidy
 * would throw away the only data there is.
 */
export function readCounters(data: StatsDoc | null): Map<string, { games: number; wins: number }> {
  const out = new Map<string, { games: number; wins: number }>();
  if (!data) return out;

  const bump = (name: string, field: string, value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const key = name.toLowerCase();
    const entry = out.get(key) ?? { games: 0, wins: 0 };
    if (field === 'games') entry.games += value;
    if (field === 'wins') entry.wins += value;
    out.set(key, entry);
  };

  for (const [name, counts] of Object.entries(data.champions ?? {})) {
    bump(name, 'games', counts?.games);
    bump(name, 'wins', counts?.wins);
  }

  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.');
    if (parts.length === 3 && parts[0] === 'champions') bump(parts[1], parts[2], value);
  }

  return out;
}

@Injectable({ providedIn: 'root' })
export class ChampionStatsService {
  private readonly champs = inject(ChampionDataService);

  private readonly raw = signal<StatsDoc | null>(null);
  /** The previous patch, kept for the combined fallback. */
  private readonly priorRaw = signal<StatsDoc | null>(null);
  private readonly loadedPatch = signal<string | null>(null);

  /** Whether a fetch has completed, so a view can tell empty from not-yet. */
  readonly ready = signal(false);

  /**
   * The patch the app is on, from Data Dragon's version.
   *
   * The crawler buckets its counters by the patch of each match, so the browser
   * can find today's bucket without any extra bookkeeping — it already knows
   * the version, and "16.17.1" and "16.17" name the same patch.
   */
  readonly patch = computed(() => {
    const parts = (this.champs.version() ?? '').split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : '';
  });

  /** Matches behind the whole bucket, so a view can say how thin it is. */
  readonly matches = computed(() => this.raw()?.matches ?? 0);

  private rates(data: StatsDoc | null, combined: boolean): Map<string, ChampionRate> {
    const out = new Map<string, ChampionRate>();
    for (const [key, { games, wins }] of readCounters(data)) {
      if (games > 0) {
        out.set(key, { games, wins, winRate: Math.round((wins / games) * 1000) / 10, combined });
      }
    }
    return out;
  }

  private readonly byChampion = computed(() => this.rates(this.raw(), false));

  /**
   * This patch and the one before it, added together.
   *
   * Only consulted when the current patch alone is too thin. Adjacent patches
   * rarely move a champion far, and a number from two patches beats no number
   * at all — but it is the fallback, not the default, and it says so.
   */
  private readonly byChampionCombined = computed(() => {
    const current = readCounters(this.raw());
    const merged = new Map(current);
    for (const [key, prior] of readCounters(this.priorRaw())) {
      const running = merged.get(key) ?? { games: 0, wins: 0 };
      merged.set(key, { games: running.games + prior.games, wins: running.wins + prior.wins });
    }
    const out = new Map<string, ChampionRate>();
    for (const [key, { games, wins }] of merged) {
      if (games > 0) {
        out.set(key, { games, wins, winRate: Math.round((wins / games) * 1000) / 10, combined: true });
      }
    }
    return out;
  });

  /**
   * Keyed the way the crawler wrote them: letters and digits only.
   *
   * Firestore field paths split on dots, so "Kai'Sa" and "Dr. Mundo" are stored
   * stripped. The same stripping has to happen on the way back out or those
   * champions silently have no rate — the failure mode is invisible, because a
   * missing rate looks exactly like a champion below the sample floor.
   */
  private key(championName: string): string {
    return championName.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  }

  /**
   * A champion's solo-queue record, or nothing when it is too thin to quote.
   *
   * This patch alone if that clears the floor, because it is the more truthful
   * answer; otherwise this patch plus the one before, flagged as combined so
   * the view can say which it got.
   */
  rate(championName: string): ChampionRate | undefined {
    const key = this.key(championName);
    const current = this.byChampion().get(key);
    if (current && current.games >= MIN_RATE_GAMES) return current;

    const both = this.byChampionCombined().get(key);
    return both && both.games >= MIN_RATE_GAMES ? both : undefined;
  }

  /** The record whatever its size, for a view that shows its own caveat. */
  rawRate(championName: string): ChampionRate | undefined {
    return this.byChampionCombined().get(this.key(championName));
  }

  /**
   * Fetch this patch's bucket, once.
   *
   * A plain `getDoc` rather than a listener: these counters change constantly
   * and none of it matters mid-draft — a win rate that ticks from 51.2 to 51.3
   * while somebody is reading it is a distraction, not an update.
   */
  async load(): Promise<void> {
    const patch = this.patch();
    const db = getDb();
    if (!patch || !db || this.loadedPatch() === patch) return;

    const prior = previousPatch(patch);
    try {
      const [snap, priorSnap] = await Promise.all([
        getDoc(doc(db, `championStats/${patch}_ALL`)),
        prior ? getDoc(doc(db, `championStats/${prior}_ALL`)) : Promise.resolve(null)
      ]);
      this.raw.set(snap.exists() ? (snap.data() as StatsDoc) : null);
      this.priorRaw.set(priorSnap?.exists() ? (priorSnap.data() as StatsDoc) : null);
      this.loadedPatch.set(patch);
    } catch {
      // No rates is a fine outcome — every view here already handles a champion
      // having none, because most do until the crawl is deep enough.
      this.raw.set(null);
      this.priorRaw.set(null);
    } finally {
      this.ready.set(true);
    }
  }
}
