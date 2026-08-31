/**
 * Building champion win rates by rank, one small bite every two minutes.
 *
 * The numbers every draft tool quotes come from millions of games. We have 159,
 * which is why `draft-advice` refuses to synthesise a matchup percentage. This
 * is the other way to close that gap: collect the games ourselves, slowly,
 * inside the rate limit, and keep only the totals.
 *
 * Riot lists "Aggregate player stats (no specific players)" as an approved use
 * case — for a **Production** key. On a Personal key the approved use is
 * "Creating a proof of concept for a Production Key request", which is exactly
 * what this is: a working crawler at modest throughput, to show alongside the
 * application rather than to run as a production pipeline.
 *
 * Nothing here stores a match, a name or a puuid's history. The output is a
 * counter per champion per tier per patch, which is the "no specific players"
 * half of that clause and also happens to be all the draft room can use.
 */

/** Ladder strata, hardest first — the order pages are walked in. */
export const TIERS = [
  'CHALLENGER',
  'GRANDMASTER',
  'MASTER',
  'DIAMOND',
  'EMERALD',
  'PLATINUM',
  'GOLD',
  'SILVER',
  'BRONZE',
  'IRON'
] as const;
export type Tier = (typeof TIERS)[number];

/** Only the apex tiers are a single group; the rest are split four ways. */
export const DIVISIONS = ['I', 'II', 'III', 'IV'] as const;

/** Apex tiers have exactly one division, and asking for II–IV returns nothing. */
export function divisionsFor(tier: Tier): readonly string[] {
  return tier === 'CHALLENGER' || tier === 'GRANDMASTER' || tier === 'MASTER' ? ['I'] : DIVISIONS;
}

/**
 * The apex tiers are served by their own endpoints, not by /entries.
 *
 * Measured 31 Aug 2026, not assumed: /entries/RANKED_SOLO_5x5/CHALLENGER/I
 * answers **400**, while /challengerleagues/by-queue returns the whole ladder —
 * 300 entries, puuid included — in a single request. The divisioned tiers do
 * work through /entries and also carry a puuid, so only the apex route differs.
 */
export function isApex(tier: Tier): boolean {
  return tier === 'CHALLENGER' || tier === 'GRANDMASTER' || tier === 'MASTER';
}

/** The path for one cursor. Every cursor has one; apex tiers just differ in route. */
export function ladderPath(cursor: LadderCursor): string {
  if (isApex(cursor.tier)) {
    return `/lol/league/v4/${cursor.tier.toLowerCase()}leagues/by-queue/RANKED_SOLO_5x5`;
  }
  return `/lol/league/v4/entries/RANKED_SOLO_5x5/${cursor.tier}/${cursor.division}?page=${cursor.page}`;
}

/** A divisioned ladder page holds about this many, which sets the fair share. */
export const ENTRIES_PER_PAGE = 205;

/**
 * How much of a ladder response to actually seed from.
 *
 * An apex ladder has no pages — it arrives whole, all 300 or 4,000 of them —
 * so taking it entire would seed one Challenger request as heavily as twenty
 * Gold pages, and the crawl would end up describing the top 0.02% of players.
 * Taking a page-sized slice makes apex weigh the same as any other page, and
 * rotating the offset by page number means successive rounds walk through the
 * ladder rather than re-seeding the same players forever.
 *
 * An earlier version returned nothing for apex past page 1. That looked like
 * restraint and was actually a hole: the cursor passes each apex page-1 exactly
 * once, so those three tiers would never have been collected again.
 */
export function sampleLadder<T>(entries: readonly T[], cursor: LadderCursor): T[] {
  if (!isApex(cursor.tier) || entries.length <= ENTRIES_PER_PAGE) return [...entries];
  const offset = ((cursor.page - 1) * ENTRIES_PER_PAGE) % entries.length;
  const slice = entries.slice(offset, offset + ENTRIES_PER_PAGE);
  // Wrap around the end rather than returning a short page.
  return slice.length === ENTRIES_PER_PAGE
    ? slice
    : [...slice, ...entries.slice(0, ENTRIES_PER_PAGE - slice.length)];
}

/**
 * Where the ladder walk is up to.
 *
 * Round-robin across tiers rather than draining one at a time: a crawler that
 * finishes Challenger before starting Iron spends its first week describing
 * 0.02% of players, and a champion's win rate is tier-dependent enough that a
 * partial ladder is worse than a smaller complete one.
 */
export interface LadderCursor {
  tier: Tier;
  division: string;
  page: number;
}

export const FIRST_CURSOR: LadderCursor = { tier: TIERS[0], division: 'I', page: 1 };

/**
 * Advance one step: next tier at the same depth, wrapping to a deeper page.
 *
 * Walking tiers on the outside and pages on the inside is what keeps the sample
 * even — every tier gets its page 1 before any tier gets its page 2.
 */
export function nextCursor(cursor: LadderCursor): LadderCursor {
  const tierIndex = TIERS.indexOf(cursor.tier);
  const safeTier = tierIndex < 0 ? 0 : tierIndex;

  const divisions = divisionsFor(cursor.tier);
  const divisionIndex = divisions.indexOf(cursor.division);
  const nextDivision = divisionIndex + 1;

  // Deeper into the same tier first.
  if (nextDivision < divisions.length) {
    return { tier: cursor.tier, division: divisions[nextDivision], page: cursor.page };
  }
  // Then on to the next tier, back at its first division.
  if (safeTier + 1 < TIERS.length) {
    const tier = TIERS[safeTier + 1];
    return { tier, division: divisionsFor(tier)[0], page: cursor.page };
  }
  // Round complete: start again one page deeper.
  return { tier: TIERS[0], division: 'I', page: cursor.page + 1 };
}

/**
 * Requests this crawler may spend in one two-minute window.
 *
 * The ceiling is 100, and taking all of it would starve the app: a comp
 * analysis refresh or a player enrichment shares this key, and a user pressing
 * Refresh must not queue behind a background job. Half is the crawler's, half
 * stays free — which halves throughput and is the right trade, because nobody
 * is waiting on the crawler.
 */
export const CRAWL_BUDGET = 50;

/** Below this many queued match ids, spend calls refilling instead of fetching. */
export const PENDING_LOW_WATER = 60;
/** Below this many known players, spend a call on a ladder page. */
export const POOL_LOW_WATER = 40;
/** Match ids per player lookup. Riot allows 100; 20 keeps the sample recent. */
export const IDS_PER_PLAYER = 20;

export interface CrawlPlan {
  /** Ladder pages to pull this run — usually 0, occasionally 1. */
  readonly ladderPages: number;
  /** Players whose recent ids to look up. */
  readonly idLookups: number;
  /** Matches to fetch and tally. Whatever is left of the budget. */
  readonly matchFetches: number;
}

/**
 * Split one run's budget between refilling the pipeline and draining it.
 *
 * Three stages feed each other — ladder page gives players, player gives match
 * ids, match id gives a game — and each costs exactly one request. Refilling is
 * done only when a stage runs dry, so nearly every request in a steady state
 * buys an actual match, which is the only stage that produces data.
 */
export function planRun(
  pendingIds: number,
  poolSize: number,
  budget: number = CRAWL_BUDGET
): CrawlPlan {
  let left = Math.max(budget, 0);

  const ladderPages = poolSize < POOL_LOW_WATER && left > 0 ? 1 : 0;
  left -= ladderPages;

  // Enough lookups to refill the queue, but never more than the pool can serve
  // and never so many that a run buys no matches at all.
  const wanted = pendingIds < PENDING_LOW_WATER ? Math.ceil((PENDING_LOW_WATER - pendingIds) / IDS_PER_PLAYER) : 0;
  const idLookups = Math.max(Math.min(wanted, poolSize, Math.floor(left / 2)), 0);
  left -= idLookups;

  return { ladderPages, idLookups, matchFetches: Math.max(left, 0) };
}

/** "15.17.704.1234" -> "15.17". Counters are bucketed per patch, never merged. */
export function patchOf(gameVersion: string | undefined): string {
  if (!gameVersion) return 'unknown';
  const parts = gameVersion.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : gameVersion;
}

/** One champion's record inside a tier bucket. */
export interface ChampionTally {
  games: number;
  wins: number;
}

/** What one match contributes: champion -> games/wins, all ten participants. */
export interface MatchTally {
  readonly patch: string;
  readonly tier: Tier;
  readonly champions: ReadonlyMap<string, ChampionTally>;
}

export interface CrawledParticipant {
  championName: string;
  win: boolean;
}

export interface CrawledMatch {
  info: {
    gameVersion?: string;
    gameDuration: number;
    queueId: number;
    participants: CrawledParticipant[];
  };
}

/** Ranked solo. The only queue whose tiers mean anything. */
export const CRAWL_QUEUE = 420;
/** Below this a game is a remake, and a remake's champions did not lose. */
const REMAKE_UNDER_SEC = 300;
/** A Summoner's Rift match has ten participants, and always exactly ten. */
const FULL_LOBBY = 10;

/**
 * Reduce one match to champion counters.
 *
 * `tier` comes from the ladder entry that led us here, not from the match —
 * Riot does not put a rank on a match. Matchmaking keeps a lobby close in rank,
 * so attributing all ten to the seed player's tier is near enough for a bucket
 * this coarse, and the alternative is ten more requests per match.
 *
 * Returns null for anything that would poison the counters rather than counting
 * it: a remake, a wrong queue, or a lobby that is not ten players.
 */
export function tallyMatch(match: CrawledMatch, tier: Tier): MatchTally | null {
  const info = match?.info;
  if (!info || info.queueId !== CRAWL_QUEUE) return null;
  if (info.gameDuration < REMAKE_UNDER_SEC) return null;

  const parts = info.participants;
  if (!Array.isArray(parts) || parts.length !== FULL_LOBBY) return null;

  const champions = new Map<string, ChampionTally>();
  for (const p of parts) {
    if (!p?.championName) return null; // A partial lobby would skew every share.
    const tally = champions.get(p.championName) ?? { games: 0, wins: 0 };
    tally.games += 1;
    if (p.win) tally.wins += 1;
    champions.set(p.championName, tally);
  }

  return { patch: patchOf(info.gameVersion), tier, champions };
}

/**
 * Firestore path for one bucket.
 *
 * One document per patch per tier: about 170 small entries, well inside the 1MB
 * limit, and a single writer so the increments never contend. Splitting finer
 * would multiply reads for no benefit; coarser would eventually overflow.
 */
export function statsDocPath(patch: string, tier: Tier): string {
  return `championStats/${patch}_${tier}`;
}

/** A champion's win rate, or nothing when the sample is too thin to quote. */
export function winRateOf(tally: ChampionTally, minGames = 200): number | undefined {
  if (!tally || tally.games < minGames) return undefined;
  return Math.round((tally.wins / tally.games) * 1000) / 10;
}
