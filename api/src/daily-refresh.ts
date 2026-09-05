/**
 * The morning refresh: the pure parts.
 *
 * `refreshTeamData` in index.ts re-reads every roster member from Riot and
 * re-runs the comp analysis before anyone is awake, so the numbers on the
 * page are the previous night's games rather than whatever someone last
 * clicked Refresh for. The Riot I/O lives beside the handlers; what a stored
 * player doc becomes after enrichment, and how the stored comps turn into an
 * analysis request, are decided here where they can be tested.
 */

export type KnownRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export const ROLES: readonly KnownRole[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

/** The fields of a stored player doc the refresh reads or writes. */
export interface StoredPlayer {
  id: string;
  name: string;
  role?: KnownRole;
  icon?: string;
  playstyle?: string;
  strengths?: string[];
  weaknesses?: string[];
  top3?: string[];
  bans?: string[];
  queueStats?: unknown;
  profile?: { region?: string; riotTag?: string; mobalyticsSlug?: string };
  /** ISO time of the last automatic or manual Riot refresh, when known. */
  refreshedAt?: string;
  /**
   * Saved by hand in Admin. From then on a refresh keeps the stats and the
   * time and leaves the text, the pool and the bans alone: a person's edit
   * outranks a generated line, and the alternative — "Lillia" reverting the
   * next morning (5 Sep 2026) — makes the form a lie.
   */
  curated?: boolean;
}

/** What enrichment hands back, as far as the merge cares. */
export interface EnrichedPlayer {
  source: 'template' | 'provider';
  role?: KnownRole;
  iconUrl?: string;
  playstyle?: string;
  strengths?: string[];
  weaknesses?: string[];
  top3?: string[];
  bans?: string[];
  queueStats?: unknown;
}

export interface StoredComp {
  id: string;
  name?: string;
  picks?: Partial<Record<KnownRole, string>>;
  countsUnder?: string | null;
}

export interface StoredOverride {
  matchId?: string;
  compId?: string;
}

/**
 * "Champion - note" → the champion. Mirrors `UiService.parseCompLine` in the
 * frontend, which is what builds the request when a person clicks Refresh;
 * the two have to agree or the morning run attributes games differently
 * from the afternoon one.
 */
export function championOfLine(text: string | undefined): string {
  const line = (text ?? '').trim();
  const separator = ' - ';
  if (!line.includes(separator)) return line;
  return line.slice(0, line.indexOf(separator)).trim();
}

/**
 * The same request the Analysis page sends, built from the stored documents.
 *
 * Comps with no champions at all are kept — the backend already copes with
 * an empty list — but a comp doc with no id cannot be attributed to and is
 * dropped. Overrides are keyed by match id and a malformed one is skipped,
 * the same leniency `parseCompAnalysisRequest` applies.
 */
export function analysisRequestFrom(
  players: readonly StoredPlayer[],
  comps: readonly StoredComp[],
  overrides: readonly StoredOverride[]
): {
  players: { id: string; name: string; riotTag?: string; region?: string }[];
  comps: { id: string; name: string; champions: string[]; countsUnder: string | null }[];
  overrides: Record<string, string>;
} {
  const overrideMap: Record<string, string> = {};
  for (const o of overrides) {
    if (o.matchId && o.compId) overrideMap[o.matchId] = o.compId;
  }
  return {
    players: players
      .filter((p) => p.id && p.name)
      .map((p) => ({
        id: p.id,
        name: p.name,
        riotTag: p.profile?.riotTag,
        region: p.profile?.region
      })),
    comps: comps
      .filter((c) => c.id)
      .map((c) => ({
        id: c.id,
        name: c.name ?? 'Comp',
        champions: ROLES.map((role) => championOfLine(c.picks?.[role])).filter(Boolean),
        countsUnder: c.countsUnder ?? null
      })),
    overrides: overrideMap
  };
}

/**
 * Fold Riot's champion list into the stored one rather than replacing it.
 * Mirrors `PlayerEnrichmentService.mergeChampionPool`: a hand-curated pool is
 * deliberate and its first entry is shown as the main, so existing picks keep
 * their order and anything new is appended.
 */
export function mergeChampionPool(existing: readonly string[] | undefined, incoming: readonly string[] | undefined): string[] {
  const norm = (name: string) => (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const merged = [...(existing ?? [])];
  const seen = new Set(merged.map(norm));
  for (const champ of incoming ?? []) {
    if (champ && !seen.has(norm(champ))) {
      merged.push(champ);
      seen.add(norm(champ));
    }
  }
  return merged;
}

/**
 * The player doc after a successful enrichment. Exactly the merge the roster
 * page performs when a person clicks Refresh, so the morning run and a manual
 * one leave the same document behind. Returns null for a template result:
 * storing invented strengths on a real person's row is worse than leaving it.
 */
export function mergePlayer(
  player: StoredPlayer,
  enriched: EnrichedPlayer,
  now: string
): StoredPlayer | null {
  if (enriched.source !== 'provider') return null;
  if (player.curated) {
    return {
      ...player,
      icon: player.icon || enriched.iconUrl,
      queueStats: enriched.queueStats ?? player.queueStats,
      refreshedAt: now
    };
  }
  return {
    ...player,
    role: enriched.role ?? player.role,
    icon: enriched.iconUrl ?? player.icon,
    playstyle: enriched.playstyle || player.playstyle,
    strengths: enriched.strengths?.length ? enriched.strengths : player.strengths ?? [],
    weaknesses: enriched.weaknesses?.length ? enriched.weaknesses : player.weaknesses ?? [],
    top3: mergeChampionPool(player.top3, enriched.top3),
    bans: enriched.bans?.length ? enriched.bans : player.bans ?? [],
    queueStats: enriched.queueStats ?? player.queueStats,
    refreshedAt: now
  };
}

/**
 * Who to refresh first: the longest un-refreshed.
 *
 * A run has nine minutes and a player costs about one, so a big roster with
 * fill-ins may not all fit. Oldest first means a truncated run still moves
 * everyone forward over a few mornings rather than refreshing the same first
 * five every day. Never-refreshed players sort first of all.
 */
export function refreshOrder<T extends { refreshedAt?: string; order?: number }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => {
    const at = a.refreshedAt ?? '';
    const bt = b.refreshedAt ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

/** What one morning run did, written to `meta/refreshLog` for the app. */
export interface RefreshLog {
  ranAt: string;
  finishedAt: string;
  trigger: 'schedule' | 'manual';
  playersUpdated: string[];
  playersFailed: string[];
  /** Players left for the next run because the time budget ran out. */
  playersSkipped: string[];
  analysis: { ok: boolean; games?: number; newMatches?: number; pending?: number; error?: string };
}

/** Seconds of the run given to players before the analysis has to start. */
export const PLAYER_BUDGET_SECONDS = 360;
