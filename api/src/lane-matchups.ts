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

/** A champion's own record needs at least this many games before it can be used to normalise anything. */
export const MIN_BASELINE_GAMES = 200;

/** Past this far from what the two champions' own strength predicts, the PAIRING is doing the work rather than the picks. */
export const MATCHUP_POINTS = 2;

/** One champion's overall record on a patch, from `championStats/{patch}_ALL`. */
export interface ChampionBaseline {
  games: number;
  /** 0-100. */
  winRate: number;
}

/**
 * What a pairing would read at if neither champion were better than the other, and how far the real
 * rate sits from it.
 *
 * Why a raw rate is not the whole answer (12 Sep 2026). Nautilus into Rell came back at 40.5% and
 * the block called it "a losing lane, badly" — but Rell wins 51.95% of all her games this patch and
 * Nautilus 49.29%, so some of that gap is simply which champion is stronger right now and not the
 * matchup at all. Telling a support they drafted a bad lane when half of it is "Rell is a strong
 * pick" is the wrong note: the first is a drafting mistake and the second is the meta.
 *
 * Bradley-Terry on the odds, which is the standard way to ask "given each one's strength, who should
 * win this?" — and it is the same method lolalytics publishes its own normalised figure with, whose
 * answer for this pairing (-2.79 points) our arithmetic reproduces from their inputs.
 */
export function normalise(observed: number, ours: ChampionBaseline | null, theirs: ChampionBaseline | null): { expected: number; delta: number } | null {
  if (!ours || !theirs) return null;
  if (ours.games < MIN_BASELINE_GAMES || theirs.games < MIN_BASELINE_GAMES) return null;
  // Clamped off the ends: a champion at 0% or 100% would divide by zero, and neither is a real rate.
  const odds = (rate: number) => {
    const p = Math.min(Math.max(rate / 100, 0.01), 0.99);
    return p / (1 - p);
  };
  const ourOdds = odds(ours.winRate);
  const expected = Math.round((ourOdds / (ourOdds + odds(theirs.winRate))) * 1000) / 10;
  return { expected, delta: Math.round((observed - expected) * 10) / 10 };
}

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
  /** What the two champions own strength alone predicts, and how far the real rate is from it; absent when either baseline is too thin. */
  expected?: number;
  delta?: number;
  /** Each champions overall win rate on that patch, for the sentence that explains the split. */
  ourBase?: number;
  theirBase?: number;
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
export function matchupFor(
  seat: LaneRole,
  ourId: string,
  theirId: string,
  docs: readonly MatchupIndexDoc[],
  baselineOf: (championId: string, patch: string) => ChampionBaseline | null = () => null
): LaneMatchup | null {
  if (!ourId || !theirId || !docs.length) return null;
  const oursIsA = ourId.localeCompare(theirId) <= 0;
  const [a, b] = oursIsA ? [ourId, theirId] : [theirId, ourId];
  const key = matchupKey(a, b);

  const withBaselines = (rate: LaneMatchup): LaneMatchup => {
    const patch = rate.patches[0];
    const ours = baselineOf(ourId, patch);
    const theirs = baselineOf(theirId, patch);
    const split = normalise(rate.winRate, ours, theirs);
    if (!split || !ours || !theirs) return rate;
    return { ...rate, ...split, ourBase: ours.winRate, theirBase: theirs.winRate };
  };

  const current = tallyOf(docs[0], key);
  if (current && current.games >= SOLID_MATCHUP_GAMES) {
    return withBaselines({ seat, ours: ourId, theirs: theirId, games: current.games, ...rateFrom(current.games, current.winsA, oursIsA), thin: false, combined: false, patches: [docs[0].patch] });
  }
  const prior = tallyOf(docs[1], key);
  const games = (current?.games ?? 0) + (prior?.games ?? 0);
  const winsA = (current?.winsA ?? 0) + (prior?.winsA ?? 0);
  if (games < MIN_MATCHUP_GAMES) return null;
  // Only the patches that actually put games in, newest first.
  const patches = [current ? docs[0].patch : null, prior ? docs[1]?.patch : null].filter((p): p is string => !!p);
  return withBaselines({
    seat,
    ours: ourId,
    theirs: theirId,
    games,
    ...rateFrom(games, winsA, oursIsA),
    thin: games < SOLID_MATCHUP_GAMES,
    combined: patches.length > 1,
    patches
  });
}

/**
 * How much of the rate is the PAIRING and how much is just which champion is stronger right now.
 *
 * This is the half that changes the coaching (12 Sep 2026). "You drafted a bad lane" and "they
 * picked the stronger champion" call for different things — the first is a drafting habit to fix,
 * the second is the meta and is nobody's mistake — and a raw win rate cannot tell them apart. Silent
 * when either champion's own record is too thin to normalise against, because a wrong split is
 * worse than none.
 */
function splitOf(rate: LaneMatchup, displayOf: (id: string) => string): string {
  if (rate.expected === undefined || rate.delta === undefined || rate.ourBase === undefined || rate.theirBase === undefined) return '';
  const strength = `${displayOf(rate.ours)} wins ${rate.ourBase}% of their games this patch and ${displayOf(rate.theirs)} ${rate.theirBase}%, so on picks alone this would read ${rate.expected}%`;
  if (Math.abs(rate.delta) < MATCHUP_POINTS) {
    return ` On strength: ${strength} — which is where it landed, so the pairing itself is worth nothing either way and this lane is simply the champions in it.`;
  }
  const worse = rate.delta < 0;
  return ` On strength: ${strength}; at ${rate.winRate}% the pairing itself ${worse ? 'costs a further' : 'is worth another'} ${Math.abs(rate.delta)} points${worse ? '' : ' on top'}.`;
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
    'These are real win rates for the two champions that stood in each lane, collected across ranked solo queue — hundreds of games a pairing. They answer the one question the rest of this prompt cannot: was that lane worth taking, BEFORE anyone played it.',
    'SAY SO WHERE IT CHANGES THE POINT. A seat that lost a lane the wider game wins half of has a play problem and owns it. A seat that lost one the wider game loses 41% of was set a harder task than the scoreline shows, and the draft owns part of it — that is a different conversation with that player, and it belongs in the draft verdict as much as in their notes. Quote the figure when you lean on it.',
    'Two things these are not. They are not anything a player of ours did, so never report one as a result of theirs; and they are not this game’s figures, so never add them to a kill count or a farm total. Where a rate is marked thin, say it is thin or leave it alone — do not rest a point on it.',
    ...usable.map((r) => {
      const sample = `${r.games} games on ${r.combined ? `patches ${r.patches.join(' and ')}` : `patch ${r.patches[0]}`}`;
      const doubt = r.thin ? ` — thin, ±${r.margin} points, so treat it as a hint and not a fact` : '';
      return `- Our ${r.seat} ${displayOf(r.ours)} into their ${displayOf(r.theirs)}: ${r.winRate}% over ${sample} — ${verdictOf(r)}${doubt}.${splitOf(r, displayOf)}`;
    })
  ];
}
