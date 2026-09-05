import { ChampionTraits, Role } from '../../models/team.models';

/**
 * Which lanes a draft wins, and what to do about it.
 *
 * A draft is two lists of five; a game is five matchups. This reads each
 * lane from what the app already knows — the collected lane matchup rate,
 * both champions' solo queue rates, whether each player actually plays the
 * champion, and the traits that decide a laning phase — and turns it into
 * one word per lane and a plan: where to put the jungler, where to play
 * safe, which objective the lead pays for.
 *
 * Every signal is optional and says so. A lane with nothing behind it reads
 * as unknown, not even; a lane read from one thin signal says so in its
 * confidence. Pure and tested; the component only gathers the inputs.
 */

/** Top, Jungle and Mid are one seat each; bot lane is two people in one fight. */
export type Lane = 'Top' | 'Jungle' | 'Mid' | 'Bot';

export const LANES: readonly Lane[] = ['Top', 'Jungle', 'Mid', 'Bot'];

export const LANE_SEATS: Record<Lane, readonly Role[]> = {
  Top: ['Top'],
  Jungle: ['Jungle'],
  Mid: ['Mid'],
  Bot: ['ADC', 'Support']
};

export type LaneVerdict = 'strong' | 'even' | 'weak' | 'unknown';

/** One seat's inputs. Anything unknown is left undefined and weighs nothing. */
export interface SeatInput {
  readonly role: Role;
  readonly ours: string;
  readonly theirs: string;
  /** Our champion into theirs in this seat, from the matchup index. */
  readonly matchup?: { winRate: number; games: number };
  /** Each champion's solo queue rate at large. */
  readonly ourSolo?: number;
  readonly theirSolo?: number;
  /**
   * How at home the player is on the champion. Absent when nothing is known
   * about the player; `none` when their pool is known and this is not in it.
   * Games and rate travel along when the record has them — our own roster
   * carries a pool without counts, a scouted opponent carries both.
   */
  readonly ourComfort?: Comfort;
  readonly theirComfort?: Comfort;
  readonly ourTraits?: ChampionTraits;
  readonly theirTraits?: ChampionTraits;
}

export interface Comfort {
  readonly level: 'main' | 'pool' | 'none';
  readonly games?: number;
  readonly winRate?: number;
}

export interface LaneRead {
  readonly lane: Lane;
  readonly ours: readonly string[];
  readonly theirs: readonly string[];
  /** Positive is us, roughly in win-rate points. */
  readonly score: number;
  readonly verdict: LaneVerdict;
  readonly confidence: 'high' | 'medium' | 'low' | 'none';
  /** Plain sentences, the largest signal first. */
  readonly reasons: readonly string[];
}

export interface GamePlan {
  /** The lane the lead is in, if any. */
  readonly snowball: Lane | null;
  /** The lane to cover, if any. */
  readonly cover: Lane | null;
  readonly lines: readonly { strong: string; rest: string; tone: 'win' | 'loss' | 'gap' }[];
}

/** Score at or beyond which a lane is called rather than even. */
export const CALL_AT = 8;

/** A matchup rate with fewer games than this says little on its own. */
const THIN_MATCHUP = 400;
/** A scouted player past this many games on a champion is a main on it. */
export const MAIN_GAMES = 20;
/** Below this the champion is in their pool, not their hands. */
export const POOL_GAMES = 5;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** One seat's contribution. Returns the points and the reasons, largest first. */
export function readSeat(seat: SeatInput): { score: number; reasons: string[]; signals: number } {
  const parts: { points: number; reason: string }[] = [];
  const { ours, theirs } = seat;
  if (!ours || !theirs) return { score: 0, reasons: [], signals: 0 };

  // The matchup itself is the strongest thing we know, and the only signal
  // that is about *these two* rather than each alone.
  if (seat.matchup) {
    const swing = clamp((seat.matchup.winRate - 50) * 2, -30, 30);
    const thin = seat.matchup.games < THIN_MATCHUP;
    parts.push({
      points: thin ? swing * 0.6 : swing,
      reason: `${ours} into ${theirs} wins ${seat.matchup.winRate}% over ${seat.matchup.games.toLocaleString()} games${thin ? ' (thin)' : ''}`
    });
  }

  // Two champions' rates at large. Half weight: it says how good each
  // champion is, not how they do against each other.
  if (seat.ourSolo !== undefined && seat.theirSolo !== undefined) {
    const diff = clamp((seat.ourSolo - seat.theirSolo) * 1.2, -12, 12);
    if (Math.abs(diff) >= 1.5) {
      parts.push({
        points: diff,
        reason: `${ours} sits at ${seat.ourSolo}% in solo queue against ${theirs} at ${seat.theirSolo}%`
      });
    }
  }

  // Comfort: the player, not the champion. A one-trick on their pick is a
  // problem the matchup number cannot see; a first-timer is an opening.
  const comfort = (who: 'ours' | 'theirs', c: Comfort | undefined, champ: string) => {
    if (!c) return;
    const sign = who === 'ours' ? 1 : -1;
    const record =
      c.games !== undefined
        ? ` (${c.games} games${c.winRate !== undefined ? `, ${c.winRate}%` : ''})`
        : '';
    if (c.level === 'main') {
      parts.push({ points: 8 * sign, reason: `${champ} is a main for ${who === 'ours' ? 'us' : 'them'}${record}` });
    } else if (c.level === 'pool') {
      parts.push({ points: 4 * sign, reason: `${champ} is in ${who === 'ours' ? 'our' : 'their'} pool${record}` });
    } else {
      parts.push({ points: -7 * sign, reason: `${champ} is not in ${who === 'ours' ? 'our' : 'their'} player's recent pool` });
    }
  };
  comfort('ours', seat.ourComfort, ours);
  comfort('theirs', seat.theirComfort, theirs);

  // What decides the first ten minutes, read off the traits. Small, because
  // it is a generalisation about kinds of champion rather than about these.
  if (seat.ourTraits && seat.theirTraits && seat.role !== 'Jungle') {
    const o = seat.ourTraits;
    const t = seat.theirTraits;
    if (o.attack === 'ranged' && t.attack === 'melee') {
      parts.push({ points: 4, reason: `${ours} is ranged into a melee ${theirs}: free trades on every last hit` });
    } else if (o.attack === 'melee' && t.attack === 'ranged') {
      parts.push({ points: -4, reason: `${ours} is melee into a ranged ${theirs}: expect to be bullied early` });
    }
    if (t.mobility - o.mobility >= 2) {
      parts.push({ points: -2, reason: `${theirs} is far more mobile: hard to punish, easy to be dived by` });
    } else if (o.mobility - t.mobility >= 2) {
      parts.push({ points: 2, reason: `${ours} is far more mobile: picks the trades` });
    }
  }

  parts.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return {
    score: parts.reduce((sum, p) => sum + p.points, 0),
    reasons: parts.map((p) => p.reason),
    signals: parts.length
  };
}

function verdictOf(score: number, signals: number): LaneVerdict {
  if (!signals) return 'unknown';
  if (score >= CALL_AT) return 'strong';
  if (score <= -CALL_AT) return 'weak';
  return 'even';
}

function confidenceOf(seats: SeatInput[], signals: number): LaneRead['confidence'] {
  if (!signals) return 'none';
  const hasMatchup = seats.some((s) => s.matchup && s.matchup.games >= THIN_MATCHUP);
  if (hasMatchup && signals >= 3) return 'high';
  if (signals >= 2) return 'medium';
  return 'low';
}

/** Read every lane. Seats missing a champion on either side read as unknown. */
export function readLanes(seats: readonly SeatInput[]): LaneRead[] {
  return LANES.map((lane) => {
    const own = LANE_SEATS[lane]
      .map((role) => seats.find((s) => s.role === role))
      .filter((s): s is SeatInput => !!s);
    const reads = own.map(readSeat);
    const filled = own.filter((s) => s.ours && s.theirs).length;
    // Bot lane is two matchups in one; average rather than sum, so a duo
    // reads on the same scale as a solo lane.
    const score = filled ? reads.reduce((sum, r) => sum + r.score, 0) / filled : 0;
    const signals = reads.reduce((sum, r) => sum + r.signals, 0);
    return {
      lane,
      ours: own.map((s) => s.ours).filter(Boolean),
      theirs: own.map((s) => s.theirs).filter(Boolean),
      score: Math.round(score),
      verdict: verdictOf(score, signals),
      confidence: confidenceOf(own, signals),
      reasons: reads.flatMap((r) => r.reasons)
    };
  });
}

const OBJECTIVE: Record<Lane, string> = {
  Top: 'grubs and Herald',
  Jungle: 'the first objective',
  Mid: 'river vision and either objective',
  Bot: 'the first dragon'
};

/** A scouted record into a comfort level. `index` is its place in their pool. */
export function comfortOf(record: { games: number; wins: number } | undefined, index: number, poolKnown: boolean): Comfort | undefined {
  if (!record) return poolKnown ? { level: 'none' } : undefined;
  const winRate = record.games ? Math.round((record.wins / record.games) * 100) : undefined;
  if (record.games >= MAIN_GAMES || (index === 0 && record.games >= POOL_GAMES)) {
    return { level: 'main', games: record.games, winRate };
  }
  if (record.games >= POOL_GAMES || record.games === 0) {
    // Zero games with a record present is a name-only pool from an old scout.
    return { level: 'pool', games: record.games || undefined, winRate };
  }
  return { level: 'pool', games: record.games, winRate };
}

/**
 * What to do with the lanes, in the order a jungler would want to hear it.
 *
 * One lane to snowball, one to cover, and the jungle's own read decides how
 * hard either can be played. Written as strong/rest pairs for the same
 * callout the enemy read uses.
 */
export function gamePlan(reads: readonly LaneRead[]): GamePlan {
  const called = reads.filter((r) => r.verdict !== 'unknown');
  const lines: GamePlan['lines'][number][] = [];
  if (!called.length) {
    return { snowball: null, cover: null, lines: [] };
  }

  const lanes = called.filter((r) => r.lane !== 'Jungle');
  const jungle = called.find((r) => r.lane === 'Jungle');
  const best = [...lanes].sort((a, b) => b.score - a.score)[0];
  const worst = [...lanes].sort((a, b) => a.score - b.score)[0];

  const snowball = best && best.verdict === 'strong' ? best.lane : null;
  const cover = worst && worst.verdict === 'weak' ? worst.lane : null;

  if (snowball && best) {
    lines.push({
      strong: `Snowball ${snowball}`,
      rest: `${best.ours.join(' and ')} should win the lane on its own — jungle paths there early, and the lead pays for ${OBJECTIVE[snowball]}.`,
      tone: 'win'
    });
  }
  if (cover && worst) {
    lines.push({
      strong: `Cover ${cover}`,
      rest: `${worst.theirs.join(' and ')} wins the lane: play for farm and vision, expect their jungler there, and do not fight without the jungler.`,
      tone: 'loss'
    });
  }
  if (jungle) {
    if (jungle.verdict === 'strong') {
      lines.push({
        strong: 'Jungle is ours',
        rest: 'invade with the strong side and take the first skirmish; their jungler has to give something.',
        tone: 'win'
      });
    } else if (jungle.verdict === 'weak') {
      lines.push({
        strong: 'Jungle is theirs',
        rest: 'ward your own camps, do not path where they can meet you, and let lanes with priority make the plays.',
        tone: 'loss'
      });
    }
  }
  if (!snowball && !cover) {
    lines.push({
      strong: 'No lane is decided',
      rest: 'the first jungle path decides the game — pick the lane with priority and commit to it.',
      tone: 'gap'
    });
  } else if (!snowball) {
    lines.push({
      strong: 'Nothing to snowball',
      rest: 'play the even lanes for priority and trade objectives across the map rather than forcing one side.',
      tone: 'gap'
    });
  }
  return { snowball, cover, lines };
}
