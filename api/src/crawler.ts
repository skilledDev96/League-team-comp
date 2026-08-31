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

/**
 * What a lookup actually returns once the time window has been applied.
 *
 * Measured, not assumed: with a fourteen-day window the first runs came back
 * with the queue empty and a third of the budget unspent, because most ladder
 * accounts have only a few games in any given fortnight. Planning against the
 * requested count rather than the delivered one starves the stage that
 * produces the data.
 */
export const EXPECTED_IDS_PER_PLAYER = 6;

/**
 * How far back to collect, in days.
 *
 * "Their last twenty ranked games" is not the same as "twenty recent games" —
 * the ladder is full of accounts that stopped playing, and asking them yields
 * matches from months ago. The first day of collecting produced fourteen patch
 * buckets holding four to seven games each, which is fourteen samples too small
 * to say anything instead of one worth reading.
 *
 * A patch runs about two weeks, so this keeps requests on games that describe
 * the game as it is now. Riot takes it as a query parameter, so the filtering
 * costs nothing — the stale ids are never returned, rather than fetched and
 * discarded.
 */
export const COLLECT_WINDOW_DAYS = 14;

/** Riot wants `startTime` in epoch **seconds**, not milliseconds. */
export function collectSince(now: number = Date.now()): number {
  return Math.floor((now - COLLECT_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);
}

/**
 * The cross-tier rollup for a patch.
 *
 * Tier buckets answer "is this champion better in Diamond than in Gold", which
 * needs a lot more games than we will have soon. One combined total per patch
 * is what the draft room can actually use, and reading it costs the browser a
 * single document instead of ten.
 */
export const ALL_TIERS = 'ALL';

/** "16.17.1" (Data Dragon) -> "16.17", so the app can find the current bucket. */
export function patchOfVersion(version: string | undefined): string {
  return patchOf(version);
}

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
  //
  // Sized on what a lookup *yields*, not what it asks for. Twenty ids are
  // requested but the fourteen-day window filters most of them out — a ladder
  // full of accounts that barely play returns a handful each — so budgeting as
  // though every player brought twenty left the queue empty and a third of the
  // run's rate-limit allowance unspent.
  const wanted =
    pendingIds < PENDING_LOW_WATER
      ? Math.ceil((PENDING_LOW_WATER - pendingIds) / EXPECTED_IDS_PER_PLAYER)
      : 0;
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
  /** The five lane pairings in this match, for the matchup counters. */
  readonly matchups: readonly LaneMatchup[];
}

export interface CrawledParticipant {
  championName: string;
  win: boolean;
  /** TOP / JUNGLE / MIDDLE / BOTTOM / UTILITY. Needed to pair the two lanes. */
  teamPosition?: string;
  /** 100 blue, 200 red — which side, so a lane pairs across and not within. */
  teamId?: number;
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

  return { patch: patchOf(info.gameVersion), tier, champions, matchups: laneMatchups(match) };
}

/** One bucket's worth of increments, ready to write in a single call. */
export interface BucketUpdate {
  readonly patch: string;
  readonly tier: string;
  /** Matches to add to the bucket total. */
  readonly matches: number;
  readonly champions: ReadonlyMap<string, ChampionTally>;
}

/**
 * Fold a whole run's tallies into one update per bucket.
 *
 * Writing per match cost three documents each — a seen marker plus a tier
 * bucket and a rollup — so a fifty-match run spent a hundred writes on counters
 * that all land in the same two or three documents. Firestore bills per write,
 * and at 28,000 matches a day that was around 58,000 writes a day buying
 * nothing that one write per bucket would not.
 *
 * Increments commute, so summing here and writing once is exactly equivalent.
 * The only thing given up is a partial result if a run dies mid-flush, and the
 * seen markers already make those matches cheap to collect again.
 */
export function mergeTallies(tallies: readonly MatchTally[]): BucketUpdate[] {
  const buckets = new Map<
    string,
    { patch: string; tier: string; matches: number; champions: Map<string, ChampionTally> }
  >();

  const into = (tier: string, tally: MatchTally) => {
    const path = `${tally.patch}_${tier}`;
    const bucket = buckets.get(path) ?? { patch: tally.patch, tier, matches: 0, champions: new Map() };
    bucket.matches += 1;
    for (const [champion, counts] of tally.champions) {
      const running = bucket.champions.get(champion) ?? { games: 0, wins: 0 };
      running.games += counts.games;
      running.wins += counts.wins;
      bucket.champions.set(champion, running);
    }
    buckets.set(path, bucket);
  };

  for (const tally of tallies) {
    into(tally.tier, tally);
    into(ALL_TIERS, tally);
  }

  return [...buckets.values()];
}

/**
 * Firestore path for one bucket.
 *
 * One document per patch per tier: about 170 small entries, well inside the 1MB
 * limit, and a single writer so the increments never contend. Splitting finer
 * would multiply reads for no benefit; coarser would eventually overflow.
 */
export function statsDocPath(patch: string, tier: string): string {
  return `championStats/${patch}_${tier}`;
}

/** A champion's win rate, or nothing when the sample is too thin to quote. */
export function winRateOf(tally: ChampionTally, minGames = 200): number | undefined {
  if (!tally || tally.games < minGames) return undefined;
  return Math.round((tally.wins / tally.games) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Lane matchups
//
// Every match already carries five of them — top against top, mid against mid
// — and the crawler was throwing them away. They cost nothing extra to collect:
// the match is already fetched and already says who stood in which lane.
//
// This is the only route to "if they take Zaahen, is Mordekaiser or Shen
// better". It needs elapsed time and nothing else, which is exactly why it is
// worth starting before it is wanted: at roughly 48 games per matchup per day,
// a common one is three weeks from saying anything, and no amount of effort
// later buys back a day not collected.
// ---------------------------------------------------------------------------

/** One lane, one pair, one result. */
export interface LaneMatchup {
  readonly lane: string;
  /** Alphabetically first of the pair, so both orderings land in one cell. */
  readonly a: string;
  readonly b: string;
  /** Whether `a` won. `b` won exactly when this is false. */
  readonly aWon: boolean;
}

/**
 * The five lane pairings in a match.
 *
 * A lane counts only when exactly two players claim it, one on each side.
 * Riot leaves `teamPosition` empty on remakes and the odd malformed game, and a
 * lane with three claimants or one is not a matchup — recording it anyway would
 * quietly file a jungler's game under top.
 */
export function laneMatchups(match: CrawledMatch): LaneMatchup[] {
  const byLane = new Map<string, CrawledParticipant[]>();
  for (const p of match?.info?.participants ?? []) {
    if (!p?.teamPosition || !p.championName) continue;
    byLane.set(p.teamPosition, [...(byLane.get(p.teamPosition) ?? []), p]);
  }

  const out: LaneMatchup[] = [];
  for (const [lane, players] of byLane) {
    if (players.length !== 2) continue;
    const [x, y] = players;
    if (x.teamId === y.teamId) continue; // Same side is not a matchup.

    // Canonical order, so Ahri-into-Syndra and Syndra-into-Ahri are one cell
    // rather than two half-filled ones.
    const [a, b] = x.championName.localeCompare(y.championName) <= 0 ? [x, y] : [y, x];
    out.push({ lane, a: a.championName, b: b.championName, aWon: a.win });
  }
  return out;
}

/** Games and wins for one pairing, from the first champion's point of view. */
export interface MatchupTally {
  games: number;
  winsA: number;
}

/**
 * Firestore path for one lane's matchups in a patch.
 *
 * Split by lane rather than one document per patch: three thousand pairings in
 * a single map would sit near Firestore's per-document index ceiling, and a
 * lane is the natural cut because nothing ever reads across lanes.
 */
export function matchupDocPath(patch: string, lane: string): string {
  return `matchupStats/${patch}_${lane}`;
}

/**
 * The field key for one pairing.
 *
 * Champion names carry apostrophes and spaces (Kai'Sa, Dr. Mundo) and a dot
 * would split the Firestore field path, so keys are letters and digits only —
 * the same rule the champion counters use.
 */
export function matchupKey(a: string, b: string): string {
  const clean = (name: string) => name.replace(/[^A-Za-z0-9]/g, '');
  return `${clean(a)}_${clean(b)}`;
}

/** One lane document's worth of matchup increments. */
export interface MatchupUpdate {
  readonly patch: string;
  readonly lane: string;
  readonly pairs: ReadonlyMap<string, MatchupTally>;
}

/**
 * Fold a run's lane pairings into one update per lane, the way the champion
 * counters already fold into one per bucket.
 *
 * Fifty matches produce two hundred and fifty pairings across five lanes, and
 * writing each on its own would spend two hundred and fifty documents on
 * something five can carry. Increments commute, so summing first is exactly
 * equivalent.
 */
export function mergeMatchups(tallies: readonly MatchTally[]): MatchupUpdate[] {
  const lanes = new Map<string, { patch: string; lane: string; pairs: Map<string, MatchupTally> }>();

  for (const tally of tallies) {
    for (const m of tally.matchups) {
      const path = `${tally.patch}_${m.lane}`;
      const bucket = lanes.get(path) ?? { patch: tally.patch, lane: m.lane, pairs: new Map() };
      const key = matchupKey(m.a, m.b);
      const running = bucket.pairs.get(key) ?? { games: 0, winsA: 0 };
      running.games += 1;
      if (m.aWon) running.winsA += 1;
      bucket.pairs.set(key, running);
      lanes.set(path, bucket);
    }
  }

  return [...lanes.values()];
}
