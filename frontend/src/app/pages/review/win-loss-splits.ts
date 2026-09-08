/**
 * What changes between the games we win and the games we lose.
 *
 * The objective factors say what a loss looked like at the end. This asks
 * the question a coach asks: over all of them, what is different when we
 * win? Which lane loses lane, does vision drop, does Top's Teleport reach a
 * fight, who is dying. Every figure is a mean over the games that carry the
 * number, with its n beside it, and nothing is said below the same floor the
 * readout uses — three of four losses is 75% and means nothing.
 *
 * Pure. The page hands in its filtered games and reads back tables and two
 * short lists of sentences: what to work on, what to keep doing.
 */
import { AnalysisGame, AnalysisPlayer } from '../../models/team.models';
import { MIN_FOR_A_CLAIM } from './loss-patterns.util';

export const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;

export interface SideStat {
  mean: number;
  n: number;
}

export interface Split {
  wins: SideStat;
  losses: SideStat;
  /** wins − losses, only when both sides have a sample. */
  gap?: number;
}

const round = (v: number, places = 1) => Math.round(v * 10 ** places) / 10 ** places;

function stat(values: number[], places = 2): SideStat {
  if (!values.length) return { mean: 0, n: 0 };
  return { mean: round(values.reduce((a, b) => a + b, 0) / values.length, places), n: values.length };
}

/** One number per game, split by result; a game without the number counts nowhere. */
export function split(games: readonly AnalysisGame[], pick: (g: AnalysisGame) => number | undefined, places = 2): Split {
  const wins: number[] = [];
  const losses: number[] = [];
  for (const g of games) {
    const v = pick(g);
    if (v === undefined || Number.isNaN(v)) continue;
    (g.win ? wins : losses).push(v);
  }
  const w = stat(wins, places);
  const l = stat(losses, places);
  return { wins: w, losses: l, ...(w.n && l.n ? { gap: round(w.mean - l.mean, places) } : {}) };
}

const enough = (s: Split) => s.wins.n >= MIN_FOR_A_CLAIM && s.losses.n >= MIN_FOR_A_CLAIM;

// ---- Per-player numbers the rows may or may not carry ------------------------

/** Kill participation from the row's own kills when the source did not compute it. */
export function killParticipationOf(p: AnalysisPlayer, game: AnalysisGame): number | undefined {
  if (p.killParticipation !== undefined) return p.killParticipation;
  const teamKills = game.players.reduce((n, q) => n + q.kills, 0);
  return teamKills > 0 ? Math.min(1, (p.kills + p.assists) / teamKills) : undefined;
}

function damageShareOf(p: AnalysisPlayer, game: AnalysisGame): number | undefined {
  if (p.facts?.damageShare !== undefined) return p.facts.damageShare;
  const team = game.players.reduce((n, q) => n + q.damage, 0);
  return team > 0 ? p.damage / team : undefined;
}

const sumIfAny = (game: AnalysisGame, pick: (p: AnalysisPlayer) => number | undefined): number | undefined => {
  let any = false;
  let total = 0;
  for (const p of game.players) {
    const v = pick(p);
    if (v === undefined) continue;
    any = true;
    total += v;
  }
  return any ? total : undefined;
};

const meanIfAny = (game: AnalysisGame, pick: (p: AnalysisPlayer) => number | undefined): number | undefined => {
  const vals = game.players.map(pick).filter((v): v is number => v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
};

const topOf = (game: AnalysisGame) => game.players.find((p) => p.position === 'Top');

// ---- Lane table ---------------------------------------------------------------

export interface LaneShare {
  /** Games where the verdict fell that way. */
  games: number;
  /** Games with a known verdict on that side. */
  n: number;
  share: number;
}

export interface LaneRow {
  role: string;
  lostInLosses: LaneShare;
  wonInWins: LaneShare;
  /** Mean gold/min and cs@10 against the lane opponent, in losses and in wins. */
  goldDiff: Split;
  csDiff: Split;
}

export interface LaneTable {
  rows: LaneRow[];
  /** Replay games: totals only, so no lane can be read. */
  skipped: number;
  /** Riot games still on a cache entry from before the lane reads. */
  waiting: number;
}

function laneOf(game: AnalysisGame, role: string) {
  return game.players.find((p) => p.position === role)?.lane;
}

function laneShare(games: readonly AnalysisGame[], role: string, win: boolean, verdict: 'won' | 'lost'): LaneShare {
  let n = 0;
  let hit = 0;
  for (const g of games) {
    if (g.win !== win) continue;
    const lane = laneOf(g, role);
    if (!lane || lane.verdict === 'unknown') continue;
    n += 1;
    if (lane.verdict === verdict) hit += 1;
  }
  return { games: hit, n, share: n ? Math.round((hit / n) * 100) : 0 };
}

export function laneTable(games: readonly AnalysisGame[]): LaneTable {
  const rows = ROLES.map((role) => ({
    role,
    lostInLosses: laneShare(games, role, false, 'lost'),
    wonInWins: laneShare(games, role, true, 'won'),
    goldDiff: split(games, (g) => laneOf(g, role)?.goldPerMinDiff, 0),
    csDiff: split(games, (g) => laneOf(g, role)?.csAt10Diff, 1)
  }));
  const skipped = games.filter((g) => g.laneData === 'none').length;
  const waiting = games.filter((g) => g.laneData !== 'none' && !g.players.some((p) => p.lane)).length;
  return { rows, skipped, waiting };
}

// ---- Team metrics -------------------------------------------------------------

export interface MetricSplit {
  key: string;
  label: string;
  /** How to print the mean. */
  unit: 'count' | 'pct' | 'minutes' | 'perMin';
  split: Split;
  higherIsBetter: boolean;
}

export function teamSplits(games: readonly AnalysisGame[]): MetricSplit[] {
  const m = (key: string, label: string, unit: MetricSplit['unit'], higherIsBetter: boolean, pick: (g: AnalysisGame) => number | undefined, places = 2): MetricSplit => ({
    key,
    label,
    unit,
    higherIsBetter,
    split: split(games, pick, places)
  });
  return [
    m('killShare', 'Kill share', 'pct', true, (g) => (g.kills && g.kills.ours + g.kills.theirs > 0 ? g.kills.ours / (g.kills.ours + g.kills.theirs) : undefined)),
    m('deaths', 'Deaths per game', 'count', false, (g) => g.players.reduce((n, p) => n + p.deaths, 0), 1),
    m('timeDead', 'Minutes dead per game', 'minutes', false, (g) => { const s = sumIfAny(g, (p) => p.facts?.timeDeadSec); return s === undefined ? undefined : s / 60; }, 1),
    m('vision', 'Vision per minute, per player', 'perMin', true, (g) => meanIfAny(g, (p) => p.facts?.visionPerMin)),
    m('controlWards', 'Control wards', 'count', true, (g) => sumIfAny(g, (p) => p.facts?.controlWards), 1),
    m('wardTakedowns', 'Wards cleared', 'count', true, (g) => sumIfAny(g, (p) => p.facts?.wardTakedowns), 1),
    m('dragons', 'Dragons', 'count', true, (g) => g.objectives?.ours.dragons, 1),
    m('firstBlood', 'First blood', 'pct', true, (g) => (g.objectives ? (g.objectives.ours.firstBlood ? 1 : 0) : undefined)),
    m('firstTower', 'First tower', 'pct', true, (g) => (g.objectives ? (g.objectives.ours.firstTower ? 1 : 0) : undefined)),
    // Riot credits a plate to every participant who took part, so a sum over
    // five counts one plate several times; per player is the honest figure.
    m('plates', 'Turret plates per player', 'count', true, (g) => meanIfAny(g, (p) => p.facts?.plates), 1),
    m('soloKills', 'Solo kills', 'count', true, (g) => sumIfAny(g, (p) => p.facts?.soloKills), 1),
    m('tpTop', "Top's Teleport takedowns", 'count', true, (g) => topOf(g)?.facts?.tpTakedowns, 1),
    m('damageBalance', 'Biggest damage share', 'pct', false, (g) => { const shares = g.players.map((p) => damageShareOf(p, g)).filter((v): v is number => v !== undefined); return shares.length ? Math.max(...shares) : undefined; })
  ];
}

// ---- Per player ---------------------------------------------------------------

export interface PlayerMetric {
  key: string;
  label: string;
  unit: MetricSplit['unit'] | 'diff';
  split: Split;
  higherIsBetter: boolean;
}

export interface SeatSplitRow {
  role: string;
  games: number;
  metrics: PlayerMetric[];
}

export interface PlayerSplitRow {
  name: string;
  /** The seat they sat in most, for the sort and the label. */
  role: string;
  games: number;
  /** Every game they played, whatever the seat. */
  metrics: PlayerMetric[];
  /** The same figures per seat, for each seat with enough games to read. */
  seats: SeatSplitRow[];
}

export function playerSplits(games: readonly AnalysisGame[]): PlayerSplitRow[] {
  const names = new Map<string, Map<string, number>>();
  for (const g of games) {
    for (const p of g.players) {
      const roles = names.get(p.name) ?? new Map<string, number>();
      roles.set(p.position, (roles.get(p.position) ?? 0) + 1);
      names.set(p.name, roles);
    }
  }
  // The team rotates seats in flex — one player sat Top in 50 games and
  // elsewhere in 88 (8 Sep 2026) — so the row is every game they played, and
  // under it the same figures per seat where a seat has enough games to read.
  // "Vs lane" is always against whoever was across them in that game.
  const metricsFor = (own: (g: AnalysisGame) => AnalysisPlayer | undefined): PlayerMetric[] => {
    const pm = (key: string, label: string, unit: PlayerMetric['unit'], higherIsBetter: boolean, pick: (p: AnalysisPlayer, g: AnalysisGame) => number | undefined, places = 2): PlayerMetric => ({
      key,
      label,
      unit,
      higherIsBetter,
      split: split(games, (g) => { const p = own(g); return p ? pick(p, g) : undefined; }, places)
    });
    return [
      pm('deaths', 'Deaths', 'count', false, (p) => p.deaths, 1),
      pm('kp', 'Kill participation', 'pct', true, (p, g) => killParticipationOf(p, g)),
      pm('damageShare', 'Damage share', 'pct', true, (p, g) => damageShareOf(p, g)),
      pm('vision', 'Vision per minute', 'perMin', true, (p) => p.facts?.visionPerMin),
      pm('goldDiff', 'Gold/min vs lane', 'diff', true, (p) => p.lane?.goldPerMinDiff, 0),
      pm('csDiff', 'CS at 10 vs lane', 'diff', true, (p) => p.lane?.csAt10Diff, 1),
      pm('tp', 'Teleport takedowns', 'count', true, (p) => p.facts?.tpTakedowns, 1)
    ];
  };
  const order = (r: string) => { const i = (ROLES as readonly string[]).indexOf(r); return i < 0 ? ROLES.length : i; };
  const rows: PlayerSplitRow[] = [];
  for (const [name, roles] of names) {
    const sorted = [...roles.entries()].sort((a, b) => b[1] - a[1]);
    const role = sorted[0]?.[0] ?? '';
    rows.push({
      name,
      role,
      games: sorted.reduce((n, [, c]) => n + c, 0),
      metrics: metricsFor((g) => g.players.find((p) => p.name === name)),
      seats: sorted
        .filter(([seat, count]) => seat && count >= MIN_FOR_A_CLAIM)
        .sort((a, b) => order(a[0]) - order(b[0]))
        .map(([seat, count]) => ({
          role: seat,
          games: count,
          metrics: metricsFor((g) => g.players.find((p) => p.name === name && p.position === seat))
        }))
    });
  }
  return rows.sort((a, b) => order(a.role) - order(b.role) || a.name.localeCompare(b.name));
}

// ---- Printing a split -----------------------------------------------------------

export type SplitUnit = MetricSplit['unit'] | 'diff';

/** One side of a split in its unit; a dash with no sample. */
export function formatSide(s: SideStat, unit: SplitUnit): string {
  if (!s.n) return '—';
  switch (unit) {
    case 'pct': return `${Math.round(s.mean * 100)}%`;
    case 'minutes': return `${s.mean} min`;
    case 'perMin': return `${s.mean}/min`;
    case 'diff': return s.mean > 0 ? `+${s.mean}` : `${s.mean}`;
    default: return `${s.mean}`;
  }
}

export function formatGap(m: { split: { gap?: number }; unit: SplitUnit }): string {
  const g = m.split.gap;
  if (g === undefined) return '—';
  const v = m.unit === 'pct' ? Math.round(g * 100) : g;
  return `${v > 0 ? '+' : ''}${v}${m.unit === 'pct' ? ' pts' : ''}`;
}

/** Whether the gap reads as good for us; null with no gap. */
export function gapIsGood(m: { split: { gap?: number }; higherIsBetter: boolean }): boolean | null {
  const g = m.split.gap;
  if (g === undefined || g === 0) return null;
  return m.higherIsBetter ? g > 0 : g < 0;
}

// ---- Work on / Keep doing -----------------------------------------------------

export interface Advice {
  key: string;
  /** The claim, set apart. */
  strong: string;
  /** The numbers and the thing to do. */
  rest: string;
  /** "over 12 losses and 17 wins" */
  n: string;
}

interface Scored extends Advice {
  effect: number;
}

/** Lane lost (or won) in at least this share of losses (wins)… */
const LANE_SHARE = 55;
/** …and at least this many points more often than on the other side. */
const LANE_GAP_POINTS = 25;
/** Vision per minute per player: a quarter of a ward a minute across five people is a habit, not noise. */
const VISION_GAP = 0.25;
/** Vision that holds in losses reads as a strength only from here. */
const VISION_GOOD = 1.4;
/** Two control wards a game is one player forgetting theirs. */
const CONTROL_WARD_GAP = 2;
/** Teleport counts only when Top takes it most games. */
const TP_USAGE = 0.6;
const TP_GAP = 0.5;
const TP_QUIET = 0.5;
const TP_GOOD = 1.0;
/** Six deaths a game more in losses is a game and a half of lost tempo. */
const DEATHS_GAP = 6;
const DEATHS_SHARE = 0.3;
const DEATHS_LOW = 12;
/** First blood or first tower thirty points more often in wins. */
const EARLY_GAP_POINTS = 30;
const EARLY_GOOD = 60;
const DRAGON_GAP = 1.0;
const SOLO_GAP = 1.5;
const DAMAGE_TOP_HEAVY = 0.4;
const DAMAGE_SPREAD = 0.34;
/** Per player: a plate and a half a game more in wins is the lane wins being cashed in. */
const PLATES_GAP = 1.5;
const TAKE = 4;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function nOf(s: Split): string {
  return `over ${s.losses.n} losses and ${s.wins.n} wins`;
}

export function workOn(games: readonly AnalysisGame[]): Advice[] {
  const out: Scored[] = [];
  const lanes = laneTable(games);
  for (const row of lanes.rows) {
    const l = row.lostInLosses;
    const w = row.wonInWins;
    const lostInWins = laneShare(games, row.role, true, 'lost');
    if (l.n < MIN_FOR_A_CLAIM || lostInWins.n < MIN_FOR_A_CLAIM) continue;
    const points = l.share - lostInWins.share;
    if (l.share >= LANE_SHARE && points >= LANE_GAP_POINTS) {
      const gold = row.goldDiff.losses.n ? `${signed(row.goldDiff.losses.mean)} gold/min` : '';
      const cs = row.csDiff.losses.n ? `${signed(row.csDiff.losses.mean)} cs at 10` : '';
      const numbers = [gold, cs].filter(Boolean).join(', ');
      out.push({
        key: `lane-${row.role}`,
        strong: `${row.role} loses lane in ${l.games} of ${l.n} losses`,
        rest: `(${lostInWins.share}% of wins)${numbers ? `: ${numbers} in those losses` : ''}. Rewatch ${row.role}'s first ten minutes and where the jungler was.`,
        n: `over ${l.n} losses and ${w.n} wins with a lane read`,
        effect: points / LANE_GAP_POINTS
      });
    }
  }

  const team = new Map(teamSplits(games).map((m) => [m.key, m.split]));
  const s = (key: string) => team.get(key) as Split;

  const vision = s('vision');
  if (enough(vision) && vision.gap !== undefined && vision.gap >= VISION_GAP) {
    out.push({ key: 'vision', strong: 'Vision drops in losses', rest: `${vision.losses.mean}/min per player against ${vision.wins.mean}/min in wins. Control ward on every back; sweep before dragon and baron.`, n: nOf(vision), effect: vision.gap / VISION_GAP });
  }
  const wards = s('controlWards');
  if (enough(wards) && wards.gap !== undefined && wards.gap >= CONTROL_WARD_GAP) {
    out.push({ key: 'controlWards', strong: `${round(wards.gap, 1)} fewer control wards in losses`, rest: `${wards.losses.mean} a game against ${wards.wins.mean} in wins.`, n: nOf(wards), effect: wards.gap / CONTROL_WARD_GAP });
  }
  const tp = s('tpTop');
  const topGames = games.filter((g) => topOf(g)?.facts?.hasTeleport !== undefined);
  const tpUsage = topGames.length ? topGames.filter((g) => topOf(g)?.facts?.hasTeleport).length / topGames.length : 0;
  if (enough(tp) && tpUsage >= TP_USAGE && tp.gap !== undefined && tp.gap >= TP_GAP && tp.losses.mean < TP_QUIET) {
    out.push({ key: 'tp', strong: "Top's Teleport joins fights in wins but not in losses", rest: `${tp.wins.mean} takedowns per win, ${tp.losses.mean} per loss. Hold Teleport for a fight after fourteen minutes rather than a lane reset.`, n: nOf(tp), effect: tp.gap / TP_GAP });
  }
  const deaths = s('deaths');
  if (enough(deaths) && deaths.gap !== undefined && -deaths.gap >= DEATHS_GAP) {
    const lossGames = games.filter((g) => !g.win);
    const total = lossGames.reduce((n, g) => n + g.players.reduce((m, p) => m + p.deaths, 0), 0);
    const byPlayer = new Map<string, number>();
    for (const g of lossGames) for (const p of g.players) byPlayer.set(p.name, (byPlayer.get(p.name) ?? 0) + p.deaths);
    const [who, count] = [...byPlayer.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const share = total ? count / total : 0;
    if (who && share >= DEATHS_SHARE) {
      const own = split(games, (g) => g.players.find((p) => p.name === who)?.deaths, 1);
      out.push({ key: 'deaths', strong: `${who} carries ${pct(share)} of the deaths in losses`, rest: `${own.losses.mean} a game against ${own.wins.mean} in wins. Position behind the frontline; die less before objectives.`, n: nOf(deaths), effect: -deaths.gap / DEATHS_GAP });
    } else {
      out.push({ key: 'deaths', strong: `${round(-deaths.gap, 1)} more deaths a game in losses`, rest: `${deaths.losses.mean} against ${deaths.wins.mean} in wins, spread across the team. Fewer fights taken without vision or numbers.`, n: nOf(deaths), effect: -deaths.gap / DEATHS_GAP });
    }
  }
  const fb = s('firstBlood');
  const ft = s('firstTower');
  const earlyGap = Math.max(fb.gap !== undefined && enough(fb) ? fb.gap * 100 : 0, ft.gap !== undefined && enough(ft) ? ft.gap * 100 : 0);
  if (earlyGap >= EARLY_GAP_POINTS) {
    out.push({ key: 'early', strong: 'Early game decides it', rest: `First blood in ${pct(fb.wins.mean)} of wins and ${pct(fb.losses.mean)} of losses; first tower ${pct(ft.wins.mean)} against ${pct(ft.losses.mean)}. Plan the first ten minutes: level-two timing, first back, jungler's path.`, n: nOf(fb), effect: earlyGap / EARLY_GAP_POINTS });
  }
  const dragons = s('dragons');
  if (enough(dragons) && dragons.gap !== undefined && dragons.gap >= DRAGON_GAP) {
    out.push({ key: 'dragons', strong: 'Dragons swing games', rest: `${dragons.wins.mean} a game in wins, ${dragons.losses.mean} in losses. Set vision at 4:30 before each spawn.`, n: nOf(dragons), effect: dragons.gap / DRAGON_GAP });
  }
  const solo = s('soloKills');
  if (enough(solo) && solo.gap !== undefined && solo.gap >= SOLO_GAP) {
    out.push({ key: 'solo', strong: 'Solo kills vanish in losses', rest: `${solo.losses.mean} a game against ${solo.wins.mean} in wins — lane pressure, not teamfights.`, n: nOf(solo), effect: solo.gap / SOLO_GAP });
  }
  const balance = s('damageBalance');
  if (enough(balance) && balance.losses.mean >= DAMAGE_TOP_HEAVY && balance.wins.mean < DAMAGE_SPREAD) {
    out.push({ key: 'damage', strong: `One player carries ${pct(balance.losses.mean)} of the damage in losses`, rest: `against ${pct(balance.wins.mean)} in wins: the other four have to deal damage too.`, n: nOf(balance), effect: (balance.losses.mean - balance.wins.mean) / (DAMAGE_TOP_HEAVY - DAMAGE_SPREAD) });
  }
  const plates = s('plates');
  if (enough(plates) && plates.gap !== undefined && plates.gap >= PLATES_GAP) {
    out.push({ key: 'plates', strong: `${plates.wins.mean} plates per player in wins, ${plates.losses.mean} in losses`, rest: 'Push after winning a 2v2; plates are the gold the lane win pays.', n: nOf(plates), effect: plates.gap / PLATES_GAP });
  }
  return out.sort((a, b) => b.effect - a.effect).slice(0, TAKE).map(({ effect: _e, ...a }) => a);
}

export function keepDoing(games: readonly AnalysisGame[]): Advice[] {
  const out: Scored[] = [];
  const lanes = laneTable(games);
  for (const row of lanes.rows) {
    const w = row.wonInWins;
    const wonInLosses = laneShare(games, row.role, false, 'won');
    if (w.n < MIN_FOR_A_CLAIM || wonInLosses.n < MIN_FOR_A_CLAIM) continue;
    const points = w.share - wonInLosses.share;
    if (w.share >= LANE_SHARE && points >= LANE_GAP_POINTS) {
      out.push({ key: `lane-${row.role}`, strong: `${row.role} wins lane in ${w.games} of ${w.n} wins`, rest: `(${wonInLosses.share}% of losses). Keep playing through it — the lane win is the win condition.`, n: `over ${wonInLosses.n} losses and ${w.n} wins with a lane read`, effect: points / LANE_GAP_POINTS });
    }
  }
  const team = new Map(teamSplits(games).map((m) => [m.key, m.split]));
  const s = (key: string) => team.get(key) as Split;
  const vision = s('vision');
  if (enough(vision) && vision.wins.mean >= VISION_GOOD && vision.losses.mean >= vision.wins.mean - 0.1) {
    out.push({ key: 'vision', strong: 'Vision holds up', rest: `${vision.losses.mean}/min per player even in losses (${vision.wins.mean}/min in wins).`, n: nOf(vision), effect: vision.wins.mean / VISION_GOOD });
  }
  const tp = s('tpTop');
  if (enough(tp) && tp.wins.mean >= TP_GOOD) {
    out.push({ key: 'tp', strong: "Top's Teleport is turning fights", rest: `${tp.wins.mean} takedowns per win after teleporting in.`, n: nOf(tp), effect: tp.wins.mean / TP_GOOD });
  }
  const deaths = s('deaths');
  if (enough(deaths) && deaths.wins.mean <= DEATHS_LOW) {
    out.push({ key: 'deaths', strong: 'Low deaths in wins', rest: `${deaths.wins.mean} a game — the wins are clean, not coin flips.`, n: nOf(deaths), effect: DEATHS_LOW / Math.max(1, deaths.wins.mean) });
  }
  const fb = s('firstBlood');
  if (enough(fb) && fb.wins.mean * 100 >= EARLY_GOOD && fb.gap !== undefined && fb.gap * 100 >= EARLY_GAP_POINTS) {
    out.push({ key: 'early', strong: `First blood in ${pct(fb.wins.mean)} of wins`, rest: `against ${pct(fb.losses.mean)} of losses — the early game is where the wins are made.`, n: nOf(fb), effect: (fb.gap * 100) / EARLY_GAP_POINTS });
  }
  const dragons = s('dragons');
  if (enough(dragons) && dragons.gap !== undefined && dragons.gap >= DRAGON_GAP) {
    out.push({ key: 'dragons', strong: 'Dragon control wins games', rest: `${dragons.wins.mean} a game in wins against ${dragons.losses.mean} in losses.`, n: nOf(dragons), effect: dragons.gap / DRAGON_GAP });
  }
  const solo = s('soloKills');
  if (enough(solo) && solo.gap !== undefined && solo.gap >= SOLO_GAP) {
    out.push({ key: 'solo', strong: 'Solo kills come with the wins', rest: `${solo.wins.mean} a game in wins against ${solo.losses.mean} in losses.`, n: nOf(solo), effect: solo.gap / SOLO_GAP });
  }
  const plates = s('plates');
  if (enough(plates) && plates.gap !== undefined && plates.gap >= PLATES_GAP) {
    out.push({ key: 'plates', strong: `${plates.wins.mean} plates per player in wins`, rest: `against ${plates.losses.mean} in losses — the lane wins are being cashed in.`, n: nOf(plates), effect: plates.gap / PLATES_GAP });
  }
  return out.sort((a, b) => b.effect - a.effect).slice(0, TAKE).map(({ effect: _e, ...a }) => a);
}
