/**
 * What solo queue at large says about the lanes we drafted (12 Sep 2026).
 *
 * The review has always been able to say how a lane *went* and never whether it was a lane worth
 * taking. Those are different questions, and only one of them is about play: a support who dies
 * nine times into a matchup the wider game loses 59.5% of has a different conversation coming than
 * one who dies nine times into a coin flip.
 *
 * The answer already existed and nothing read it. `matchupIndex/{patch}_{LANE}` is published daily
 * by `buildMatchupIndex` from the crawler's own collection — hundreds of games a pairing, tens of
 * thousands a lane — and until now only the draft room ever opened it. This module turns it into
 * the lines a review reads.
 *
 * **Why this and not the damage model.** `docs/lane-matchup-model-spec.md` proposes computing a
 * damage ceiling per matchup instead. A prototype of it (12 Sep 2026) put Nautilus ahead of Rell at
 * every checkpoint, in a pairing this data says we lose 40.5% of over 597 games — and the game that
 * prompted the work had our Nautilus go 0/9/15 into that Rell. The ceiling cannot see engage range,
 * crowd control, shields or a passive, which is most of what decides a lane. This is measured and
 * that was modelled; where they disagree, this wins.
 *
 * Pure. The Firestore read is in index.ts; everything here is arithmetic over what it fetched.
 */
import { matchupKey } from './crawler';
import { LaneRole } from './lane-read';

/** Our seat names to Riot's lane names, which is how the crawler buckets a matchup. */
export const LANE_OF: Record<LaneRole, string> = {
  Top: 'TOP',
  Jungle: 'JUNGLE',
  Mid: 'MIDDLE',
  ADC: 'BOTTOM',
  Support: 'UTILITY'
};

/**
 * The honesty threshold, mirroring `MatchupStatsService` on the frontend. At 200 games the
 * +/-0.98/sqrt(n) interval is about +/-0.7 points, tight enough for a lopsided matchup to separate
 * from an even one. Below it a rate is still worth saying, but only as a hint with its margin.
 */
export const SOLID_MATCHUP_GAMES = 200;

/** Below this nothing is quoted at all: the index does not publish under 50, so asking is pointless. */
export const MIN_MATCHUP_GAMES = 50;

/** Past this far from even, a lane was a real edge on paper rather than a coin flip. */
export const EDGE_POINTS = 3;

/** One published lane document, as `matchupIndex/{patch}_{LANE}` stores it. */
export interface MatchupIndexDoc {
  patch: string;
  lane: string;
  pairs?: Record<string, { games?: number; winsA?: number } | undefined>;
}

/** What the wider game did with one of our lanes. `winRate` is OURS, already flipped if we sorted second. */
export interface LaneMatchup {
  seat: LaneRole;
  /** Riot ids, not display names: that is what the crawler keyed on. */
  ours: string;
  theirs: string;
  games: number;
  winRate: number;
  /** The 95% half-interval in points, so a thin rate carries its own doubt. */
  margin: number;
  thin: boolean;
  /** Two patches added to reach a usable sample, rather than this patch alone. */
  combined: boolean;
  /**
   * The patches the games actually came from, newest first — and only the ones that contributed.
   *
   * Not "the newest patch we looked at", which is what it said until it was run against a real game
   * (12 Sep 2026) and reported 650 games of Akali into Yasuo as patch 16.18 when every one of them
   * was collected on 16.17. A crawler part-way into a new patch has a document for it holding
   * almost nothing, so the common case is that the newest patch we READ is not the patch the
   * figure is FROM, and citing it is a small lie in the one block whose whole job is provenance.
   */
  patches: string[];
}

/**
 * The stored tally read as our side's rate.
 *
 * `oursIsA` matters as much as the key and is the one thing that must never be got wrong: `winsA`
 * counts wins for whichever champion sorted FIRST, so reading it as ours when it is theirs turns a
 * 41% hard counter into a 59% free lane. That is worse than printing nothing, and it is worse in
 * the direction that would make a coach defend a draft that lost them the game.
 */
function rateFrom(games: number, winsA: number, oursIsA: boolean): { winRate: number; margin: number } {
  const wins = oursIsA ? winsA : games - winsA;
  return {
    winRate: Math.round((wins / games) * 1000) / 10,
    margin: Math.round(980 / Math.sqrt(games)) / 10
  };
}

function tallyOf(doc: MatchupIndexDoc | null | undefined, key: string): { games: number; winsA: number } | null {
  const raw = doc?.pairs?.[key];
  const games = Number(raw?.games);
  const winsA = Number(raw?.winsA);
  if (!Number.isFinite(games) || !Number.isFinite(winsA) || games <= 0 || winsA < 0 || winsA > games) return null;
  return { games, winsA };
}

/**
 * One lane's rate, from the newest patch that can carry it.
 *
 * This patch alone when it clears `SOLID_MATCHUP_GAMES`, because it is the more truthful answer;
 * otherwise this patch and the one before it added, and flagged as combined. A matchup rarely
 * swings between adjacent patches and two patches of data beats none — but it is the fallback, not
 * the default, which is the same rule the draft room follows so the two can never quote different
 * numbers for the same lane.
 *
 * `docs` is newest patch first. Champions are Riot ids.
 */
export function matchupFor(seat: LaneRole, ourId: string, theirId: string, docs: readonly MatchupIndexDoc[]): LaneMatchup | null {
  if (!ourId || !theirId || !docs.length) return null;
  const oursIsA = ourId.localeCompare(theirId) <= 0;
  const [a, b] = oursIsA ? [ourId, theirId] : [theirId, ourId];
  const key = matchupKey(a, b);

  const current = tallyOf(docs[0], key);
  if (current && current.games >= SOLID_MATCHUP_GAMES) {
    return { seat, ours: ourId, theirs: theirId, games: current.games, ...rateFrom(current.games, current.winsA, oursIsA), thin: false, combined: false, patches: [docs[0].patch] };
  }
  const prior = tallyOf(docs[1], key);
  const games = (current?.games ?? 0) + (prior?.games ?? 0);
  const winsA = (current?.winsA ?? 0) + (prior?.winsA ?? 0);
  if (games < MIN_MATCHUP_GAMES) return null;
  // Only the patches that actually put games in, newest first.
  const patches = [current ? docs[0].patch : null, prior ? docs[1]?.patch : null].filter((p): p is string => !!p);
  return {
    seat,
    ours: ourId,
    theirs: theirId,
    games,
    ...rateFrom(games, winsA, oursIsA),
    thin: games < SOLID_MATCHUP_GAMES,
    combined: patches.length > 1,
    patches
  };
}

/** How a rate reads to a coach, in the fewest words that are still true. */
function verdictOf(rate: LaneMatchup): string {
  const points = rate.winRate - 50;
  if (Math.abs(points) < EDGE_POINTS) return 'even on paper';
  if (points > 0) return `a lane we were favoured in${points >= 8 ? ', strongly' : ''}`;
  return `a losing lane before anyone played it${points <= -8 ? ', badly' : ''}`;
}

/**
 * The block a review reads, or nothing when no lane cleared the floor.
 *
 * The heading works hard on purpose. Every other figure in the prompt is OUR game, and this one is
 * not — it is the wider game's verdict on the five pairings we drafted, and a model told only "41%"
 * would happily report it as something our own players did.
 */
export function matchupLines(rates: readonly LaneMatchup[], displayOf: (id: string) => string = (id) => id): string[] {
  const usable = rates.filter((r): r is LaneMatchup => !!r);
  if (!usable.length) return [];
  return [
    'THE LANES AS A DRAFT, FROM SOLO QUEUE AT LARGE (not our games, and not this game)',
    'These are real win rates for the two champions that stood in each lane, collected across ranked solo queue — hundreds of games a pairing. They say whether a lane was worth taking BEFORE anyone played it, which is a different question from how it went. Use them to separate the two: a lane lost at 41% is a draft problem as much as a play problem, and a lane lost at 50% is not a draft problem at all. Never report one of these as something a player of ours did, and never add them to this game’s own figures.',
    ...usable.map((r) => {
      const sample = `${r.games} games on ${r.combined ? `patches ${r.patches.join(' and ')}` : `patch ${r.patches[0]}`}`;
      const doubt = r.thin ? ` — thin, ±${r.margin} points, so treat it as a hint and not a fact` : '';
      return `- Our ${r.seat} ${displayOf(r.ours)} into their ${displayOf(r.theirs)}: ${r.winRate}% over ${sample} — ${verdictOf(r)}${doubt}.`;
    })
  ];
}
