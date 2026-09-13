import { Role, ROLES, Scrim, SeriesGame } from '../models/team.models';

/**
 * Who carried a game, and who carried a series (11 Sep 2026, queue items 5
 * and 6; role-aware since 13 Sep 2026).
 *
 * The lead: "a support player doesn't get so many kills and damage… it should
 * still be possible for each player to become an MVP". The first line counted
 * three a kill, one and a half an assist and two off a death for every seat, so
 * on 156 of our Riot games a support was MVP 7 times and never once in a win.
 *
 * Now every seat is judged on four figures its role is meant to produce,
 * counted equally, each against that role's usual game: kill participation
 * and deaths for everyone, then damage share and damage taken for a top,
 * damage share and vision for a jungler, damage share and farm for a mid and
 * an ADC, vision and assists for a support. The usual is the median of 354
 * real team-sides (both teams, every source, remakes out) and the spread its
 * IQR/1.349; a figure is how many spreads above the usual it sits, clamped at
 * 2.5 so one freak number cannot carry a game. Three proposals were simulated
 * over 1,840 real seats and two judges picked this one: across both teams the
 * MVPs now fall 20/21/22/22/16% by role (14/29/19/31/7% before), a support
 * was MVP of 12 of our 68 won Riot games, and both tournament titles stayed
 * where they were. The constants are frozen on purpose: crowns are recomputed
 * on every render, so a rolling baseline would quietly rewrite past titles.
 *
 * The arithmetic lives here once, with the terms that carried it in words,
 * because nobody should have to trust a number they cannot see the parts of.
 * Nothing here is ever called a score on screen: the chip says MVP and then
 * the terms, each with the role's usual beside it.
 *
 * The shape is structural on purpose. An analysed Riot game, a replay's five
 * and a game row all carry the same handful of figures under different
 * names; a caller maps its own rows onto `MvpPlayer` and the arithmetic is the
 * same for all three. `film-build.ts` imports `mvpSeatOf`, so the film's face
 * and the chip can never name two seats.
 */

/** One seat's line in a game, as much of it as the source knows. A missing figure is missing, never a zero. */
export interface MvpPlayer {
  /** Our roster member, when the source names one; a replay's non-roster teammate has none. */
  name?: string | null;
  /** Riot's position ("BOTTOM") or our seat word ("ADC"); both are read. */
  position: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  /** Damage to champions. Absent on a source that does not carry it, and then no damage term is claimed. */
  damage?: number;
  /** Share of the team's kills this seat was in on, 0-1. Absent on a replay, where it is worked out from the kills. */
  killParticipation?: number;
  /** Minions and monsters. */
  cs?: number;
  damageTaken?: number;
  visionScore?: number;
}

/** A game as this module needs it: our five, the team's kills when the source counted them, and how long it ran. */
export interface MvpGame {
  players: readonly MvpPlayer[];
  kills?: { ours: number; theirs: number };
  /** Every per-minute figure and the remake rule need it; without it those terms are simply not claimed. */
  durationSec?: number;
}

export interface GameMvp {
  seat: Role;
  /** Our roster member, when the game named one. */
  name?: string;
  champion: string;
  /** The seat's value: how far above its role's usual game it played, in spreads. Never shown. */
  points: number;
  /** The two or three terms that carried it, each a phrase the team can read. */
  why: string[];
}

/** One game of a series, with the label the tooltip shows it under ("Game 2"). */
export interface SeriesMvpGame {
  label: string;
  game: MvpGame;
}

export interface SeriesMvp {
  seat: Role;
  name?: string;
  /** The champion of their best game of the series, so the tile shows what the terms are about. */
  champion: string;
  /** The average value over the games this seat played. Never shown. */
  points: number;
  /** How many games of the series this seat played. */
  games: number;
  /**
   * How many games of the series carried figures at all, and how many games the series has
   * (12 Sep 2026).
   *
   * The mark is an average, and until now nothing said what it was an average OF. A tournament
   * game only carries figures once its replay is imported, so a Bo3 with one `.rofl` dropped in
   * produces a "Series MVP" that is, correctly and invisibly, one game's MVP — which is exactly
   * what it was read as. `read` is what the average saw; `of` is what was played.
   */
  read: number;
  of: number;
  /** One line a game: "Game 2 on Jinx: in on 74% of our kills (ADCs usually 49%) · died twice in 31 min (ADCs usually die 7)". */
  why: string[];
  /** The sentence under the chip: what the average is over. */
  line: string;
}

/** Riot's positions and our seat words both turn up on a player, depending on the source. */
const POSITION_SEAT: Record<string, Role> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support',
  Top: 'Top',
  Jungle: 'Jungle',
  Mid: 'Mid',
  ADC: 'ADC',
  Support: 'Support'
};

/** The seat a position names, or nothing when the source used a word we do not know. */
export function seatOfPosition(position: string): Role | undefined {
  return POSITION_SEAT[position];
}

const seatIndex = (seat: Role) => ROLES.indexOf(seat);

/** The figures a role can be judged on. Every one exists on every source that carries figures at all. */
export type MvpMetric = 'kp' | 'damageShare' | 'damageTakenShare' | 'visionPerMin' | 'csPerMin' | 'assistsPerMin' | 'deathsPerMin';

/** Four figures a role, counted equally; deaths count against (13 Sep 2026). */
export const MVP_TERMS: Record<Role, Partial<Record<MvpMetric, 1 | -1>>> = {
  Top: { kp: 1, damageShare: 1, damageTakenShare: 1, deathsPerMin: -1 },
  Jungle: { kp: 1, damageShare: 1, visionPerMin: 1, deathsPerMin: -1 },
  Mid: { kp: 1, damageShare: 1, csPerMin: 1, deathsPerMin: -1 },
  ADC: { kp: 1, damageShare: 1, csPerMin: 1, deathsPerMin: -1 },
  Support: { kp: 1, visionPerMin: 1, assistsPerMin: 1, deathsPerMin: -1 }
};

/**
 * Each role's usual game (13 Sep 2026): the median and IQR/1.349 of every seat in 354 real team-sides — both teams,
 * 156 Riot Flex games and 21 replays, remakes out — rounded to three significant figures. Frozen: crowns are
 * recomputed on every render, so these move only by a deliberate change, re-derived from the same kind of data.
 */
export const MVP_BASELINES: Record<Role, Partial<Record<MvpMetric, { centre: number; spread: number }>>> = {
  Top: { kp: { centre: 0.364, spread: 0.148 }, damageShare: { centre: 0.215, spread: 0.081 }, damageTakenShare: { centre: 0.246, spread: 0.0615 }, deathsPerMin: { centre: 0.2, spread: 0.107 } },
  Jungle: { kp: { centre: 0.5, spread: 0.168 }, damageShare: { centre: 0.173, spread: 0.0714 }, visionPerMin: { centre: 0.986, spread: 0.302 }, deathsPerMin: { centre: 0.182, spread: 0.102 } },
  Mid: { kp: { centre: 0.44, spread: 0.16 }, damageShare: { centre: 0.222, spread: 0.0654 }, csPerMin: { centre: 6.48, spread: 1.48 }, deathsPerMin: { centre: 0.211, spread: 0.115 } },
  ADC: { kp: { centre: 0.489, spread: 0.144 }, damageShare: { centre: 0.219, spread: 0.0656 }, csPerMin: { centre: 6.5, spread: 1.15 }, deathsPerMin: { centre: 0.215, spread: 0.114 } },
  Support: { kp: { centre: 0.522, spread: 0.138 }, visionPerMin: { centre: 2.53, spread: 0.685 }, assistsPerMin: { centre: 0.419, spread: 0.198 }, deathsPerMin: { centre: 0.245, spread: 0.111 } }
};

/** How many spreads one figure may count for, either way. */
export const MVP_CLAMP = 2.5;

/** Under five minutes a game is a remake: nobody carried it. */
export const REMAKE_SECONDS = 300;

/** A figure's lift names it on the chip only from half a spread above the usual. */
const WHY_FROM = 0.5;

const ROLE_WORDS: Record<Role, string> = { Top: 'tops', Jungle: 'junglers', Mid: 'mids', ADC: 'ADCs', Support: 'supports' };

/** One figure of a seat's line, against its role's usual. */
interface MvpTerm {
  metric: MvpMetric;
  value: number;
  /** The weight times the clamped spreads: how much this figure lifted (or sank) the seat. */
  lift: number;
}

/** One seat's line, valued and said. Internal: the exported entries hand back only what a surface shows. */
interface MvpLine {
  seat: Role;
  name?: string;
  champion: string;
  points: number;
  /** For the tie-breaks: participation (absent when the game counted no kills) and deaths. */
  kp?: number;
  deaths: number;
  why: string[];
}

type Figures = Partial<Record<MvpMetric, number>>;

/** A remake has a length and it is under five minutes. An unknown length is not a remake. */
export function isRemake(game: Pick<MvpGame, 'durationSec'>): boolean {
  return typeof game.durationSec === 'number' && game.durationSec > 0 && game.durationSec < REMAKE_SECONDS;
}

/**
 * Every seat's figures, game-wide. A figure missing for any one of our seats is missing for all of them, so no seat
 * is compared on something another seat was not; shares are over the seats present, and a zero total claims nothing.
 */
function figuresOf(game: MvpGame, players: readonly MvpPlayer[]): Figures[] {
  const minutes = game.durationSec && game.durationSec > 0 ? game.durationSec / 60 : null;
  const all = (key: 'damage' | 'killParticipation' | 'cs' | 'damageTaken' | 'visionScore') => players.every((p) => typeof p[key] === 'number');
  const sum = (key: 'damage' | 'damageTaken') => players.reduce((n, p) => n + (p[key] ?? 0), 0);
  const teamKills = game.kills?.ours ?? players.reduce((n, p) => n + p.kills, 0);
  const riotKp = all('killParticipation');
  const damage = all('damage') ? sum('damage') : 0;
  const taken = all('damageTaken') ? sum('damageTaken') : 0;
  const vision = all('visionScore');
  const cs = all('cs');
  return players.map((p) => {
    const f: Figures = {};
    if (riotKp) f.kp = p.killParticipation;
    else if (teamKills > 0) f.kp = Math.min(1, (p.kills + p.assists) / teamKills);
    if (damage > 0) f.damageShare = (p.damage ?? 0) / damage;
    if (taken > 0) f.damageTakenShare = (p.damageTaken ?? 0) / taken;
    if (minutes) {
      if (vision) f.visionPerMin = (p.visionScore ?? 0) / minutes;
      if (cs) f.csPerMin = (p.cs ?? 0) / minutes;
      f.assistsPerMin = p.assists / minutes;
      f.deathsPerMin = p.deaths / minutes;
    }
    return f;
  });
}

/** A seat's value: the average of its role's figures present, each in clamped spreads from the usual. */
function valueOf(seat: Role, figures: Figures): { points: number; terms: MvpTerm[] } | null {
  let lifted = 0;
  let weights = 0;
  const terms: MvpTerm[] = [];
  for (const [metric, weight] of Object.entries(MVP_TERMS[seat]) as [MvpMetric, number][]) {
    const value = figures[metric];
    const usual = MVP_BASELINES[seat][metric];
    if (value === undefined || !usual) continue;
    const spreads = Math.max(-MVP_CLAMP, Math.min(MVP_CLAMP, (value - usual.centre) / usual.spread));
    terms.push({ metric, value, lift: weight * spreads });
    lifted += weight * spreads;
    weights += Math.abs(weight);
  }
  return weights ? { points: lifted / weights, terms } : null;
}

/** The one order for a game and a series: value to three places, then participation, then fewer deaths, then lane order. */
function byCarry(a: Pick<MvpLine, 'points' | 'kp' | 'deaths' | 'seat'>, b: Pick<MvpLine, 'points' | 'kp' | 'deaths' | 'seat'>): number {
  return Math.round(b.points * 1000) - Math.round(a.points * 1000) || (b.kp ?? -1) - (a.kp ?? -1) || a.deaths - b.deaths || seatIndex(a.seat) - seatIndex(b.seat);
}

/** "died twice" is a phrase; "died 2 times" is not. Past five it is a digit again. */
const DEATH_WORDS = ['never died', 'died once', 'died twice', 'died three times', 'died four times', 'died five times'];
function deathsTerm(deaths: number): string {
  return DEATH_WORDS[deaths] ?? `died ${deaths} times`;
}

const percent = (share: number) => Math.round(share * 100);

/** One figure in words, with the role's usual beside it. A count is said as a count, over this game's length. */
function termWords(term: MvpTerm, seat: Role, player: MvpPlayer, minutes: number): string {
  const who = ROLE_WORDS[seat];
  const usual = MVP_BASELINES[seat][term.metric]!.centre;
  switch (term.metric) {
    case 'kp':
      return `in on ${percent(term.value)}% of our kills (${who} usually ${percent(usual)}%)`;
    case 'damageShare':
      return `${percent(term.value)}% of our damage (${who} usually ${percent(usual)}%)`;
    case 'damageTakenShare':
      return `took ${percent(term.value)}% of the damage we took (${who} usually ${percent(usual)}%)`;
    case 'visionPerMin':
      return `${term.value.toFixed(1)} vision a minute (${who} usually ${usual.toFixed(1)})`;
    case 'csPerMin':
      return `${term.value.toFixed(1)} CS a minute (${who} usually ${usual.toFixed(1)})`;
    case 'assistsPerMin':
      return `${player.assists} ${player.assists === 1 ? 'assist' : 'assists'} (${who} usually ${Math.round(usual * minutes)})`;
    case 'deathsPerMin':
      return `${deathsTerm(player.deaths)} in ${Math.round(minutes)} min (${who} usually die ${Math.round(usual * minutes)})`;
  }
}

/**
 * The two or three terms behind a line, strongest first and deaths last (13 Sep 2026). A figure is named when it
 * lifted the seat by half a spread; deaths only at four or fewer and when at most one teammate died fewer, so "died
 * eight times" is never offered as a reason. Short of two, the next figure that lifted it at all joins; short of that,
 * the K/D/A follows as a plain fact.
 */
function whyOf(seat: Role, player: MvpPlayer, terms: readonly MvpTerm[], team: readonly MvpPlayer[], minutes: number): string[] {
  const fewerDeaths = team.filter((p) => p !== player && p.deaths < player.deaths).length;
  const sayable = (t: MvpTerm) => t.metric !== 'deathsPerMin' || (player.deaths <= 4 && fewerDeaths <= 1);
  const lifting = terms.filter((t) => t.lift > 0 && sayable(t)).sort((a, b) => b.lift - a.lift);
  let chosen = lifting.filter((t) => t.lift >= WHY_FROM).slice(0, 3);
  if (chosen.length < 2) chosen = [...chosen, ...lifting.filter((t) => !chosen.includes(t))].slice(0, 2);
  chosen.sort((a, b) => Number(a.metric === 'deathsPerMin') - Number(b.metric === 'deathsPerMin') || b.lift - a.lift);
  const words = chosen.map((t) => termWords(t, seat, player, minutes));
  if (words.length < 2) words.push(`${player.kills}/${player.deaths}/${player.assists}`);
  return words;
}

/** Every seat of ours with its value and its terms, best first. A remake, or a game with nothing to read, has none. */
function linesOf(game: MvpGame): MvpLine[] {
  if (isRemake(game)) return [];
  const seated = (game.players ?? []).flatMap((p) => {
    const seat = seatOfPosition(p.position);
    // A source that used a word we do not know is left out rather than filed under a seat it might not be.
    return seat ? [{ p, seat }] : [];
  });
  if (!seated.length) return [];
  const players = seated.map((s) => s.p);
  const figures = figuresOf(game, players);
  const minutes = game.durationSec && game.durationSec > 0 ? game.durationSec / 60 : 0;
  const lines: MvpLine[] = [];
  seated.forEach(({ p, seat }, i) => {
    const valued = valueOf(seat, figures[i]);
    if (!valued) return;
    const line: MvpLine = { seat, champion: p.champion ?? '', points: valued.points, deaths: p.deaths, why: whyOf(seat, p, valued.terms, players, minutes) };
    if (figures[i].kp !== undefined) line.kp = figures[i].kp;
    if (p.name) line.name = p.name;
    lines.push(line);
  });
  return lines.sort(byCarry);
}

/**
 * The seat the poster fronts: the same line as the chip, so the film's face
 * and the MVP can never name two seats.
 */
export function mvpSeatOf(game: MvpGame | undefined | null): Role | undefined {
  return game ? linesOf(game)[0]?.seat : undefined;
}

/** Who carried the game, with the terms that carried it; nothing for a remake or a game with no seats we can read. */
export function mvpOf(game: MvpGame | undefined | null): GameMvp | null {
  const best = game ? linesOf(game)[0] : undefined;
  if (!best) return null;
  const mvp: GameMvp = { seat: best.seat, champion: best.champion, points: best.points, why: best.why };
  if (best.name) mvp.name = best.name;
  return mvp;
}

/**
 * Who carried the series: the best average per game over the games that seat
 * played, so three quiet games do not outweigh one carried one and a sub who
 * played once is judged on the game they played. A tie on the average goes
 * through the game's own order: the better average participation, then fewer
 * deaths, then lane order — so a one-game series names that game's MVP.
 *
 * The champion on the tile is the one from their best game of the series,
 * because a seat plays a different champion every game and the terms under
 * the chip say which game each line came from.
 *
 * The name is the seat's only while one person held it. Two players sharing
 * a seat across a Bo5 is the truth of a roster with a sub on it, and naming
 * one of them over an average built from both credits them with the other's
 * games; the chip then shows the seat and the champion of the best game, and
 * the per-game lines say what each was.
 */
export function seriesMvpOf(games: readonly SeriesMvpGame[], seriesGames?: number): SeriesMvp | null {
  const running = new Map<Role, { names: Set<string>; champion: string; bestPoints: number; points: number; kp: number; kpGames: number; deaths: number; games: number; why: string[] }>();
  for (const { label, game } of games) {
    for (const line of linesOf(game)) {
      const seat = running.get(line.seat) ?? { names: new Set<string>(), champion: line.champion, bestPoints: Number.NEGATIVE_INFINITY, points: 0, kp: 0, kpGames: 0, deaths: 0, games: 0, why: [] };
      seat.points += line.points;
      if (line.kp !== undefined) {
        seat.kp += line.kp;
        seat.kpGames += 1;
      }
      seat.deaths += line.deaths;
      seat.games += 1;
      // Every name that played the seat, not the last one written (11 Sep 2026, second fix pass): with a substitute the
      // mark used to credit whoever played the final game with an average built out of two people's games. When the
      // games disagree the chip carries no name at all and stands on the champion of the best game instead.
      if (line.name) seat.names.add(line.name);
      if (line.points > seat.bestPoints) {
        seat.bestPoints = line.points;
        seat.champion = line.champion;
      }
      seat.why.push(`${label}${line.champion ? ` on ${line.champion}` : ''}: ${line.why.join(' · ')}`);
      running.set(line.seat, seat);
    }
  }
  const best = [...running.entries()]
    .map(([seat, r]) => ({ seat, ...r, points: r.points / r.games, kp: r.kpGames ? r.kp / r.kpGames : undefined, deaths: r.deaths / r.games }))
    .sort(byCarry)[0];
  if (!best) return null;
  const read = games.filter((g) => linesOf(g.game).length > 0).length;
  const of = Math.max(seriesGames ?? read, read);
  const mvp: SeriesMvp = {
    seat: best.seat,
    champion: best.champion,
    points: best.points,
    games: best.games,
    read,
    of,
    why: best.why,
    line: lineFor(read, of, best.games)
  };
  const [only] = [...best.names];
  if (best.names.size === 1 && only) mvp.name = only;
  return mvp;
}

/**
 * What the average was actually over, in words (12 Sep 2026).
 *
 * Three different sentences, because three different things can be true and the reader acts on
 * them differently: the series has one game; the series has more games but only some carry
 * figures, and importing the rest would move the mark; or every game counted.
 */
function lineFor(read: number, of: number, seatGames: number): string {
  if (of <= 1) return 'The one game of this series so far — the same answer as that game’s own MVP.';
  if (read < of) {
    const missing = of - read;
    return `Averaged over the ${read} of ${of} games that carry figures. ${missing} ${missing === 1 ? 'game has' : 'games have'} no replay imported yet, so this may move.`;
  }
  return `Best line per game across all ${of} games${seatGames < of ? `, of which this seat played ${seatGames}` : ''}.`;
}

/** One of our seats on a game row, whichever of the three sources the row came from. Structural, so `pages/games/game-rows.ts` fits without core knowing about it. */
interface MvpRowPlayer {
  role: string;
  champion: string;
  /** Our roster member, or null for a teammate who is not on it. */
  player: string | null;
  /** Absent on a tournament game typed in by hand: ten champions and a result, no figures. */
  stats?: { kills: number; deaths: number; assists: number; cs?: number; damage?: number; damageTaken?: number; vision?: number; killParticipation?: number };
}

/**
 * A game row as a line-up this module can read (11 Sep 2026). A row with no
 * figures on any seat comes back with nobody in it, and the row's chip is
 * simply not drawn — a tournament game we typed in knows who played what and
 * nothing else, and inventing an MVP off five champions would be a lie.
 */
export function mvpGameFromRow(row: { ours: readonly MvpRowPlayer[]; kills?: { ours: number; theirs: number }; durationSec?: number }): MvpGame {
  const players = row.ours
    .filter((p) => !!p.stats)
    .map((p) => ({
      name: p.player,
      position: p.role,
      champion: p.champion,
      kills: p.stats!.kills,
      deaths: p.stats!.deaths,
      assists: p.stats!.assists,
      ...(typeof p.stats!.damage === 'number' ? { damage: p.stats!.damage } : {}),
      ...(typeof p.stats!.killParticipation === 'number' ? { killParticipation: p.stats!.killParticipation } : {}),
      ...(typeof p.stats!.cs === 'number' ? { cs: p.stats!.cs } : {}),
      ...(typeof p.stats!.damageTaken === 'number' ? { damageTaken: p.stats!.damageTaken } : {}),
      ...(typeof p.stats!.vision === 'number' ? { visionScore: p.stats!.vision } : {})
    }));
  return { players, ...(row.kills ? { kills: row.kills } : {}), ...(row.durationSec ? { durationSec: row.durationSec } : {}) };
}

/**
 * Our five out of a replay, as lines this module can read (11 Sep 2026).
 *
 * A custom never reaches the Riot API, so a tournament game's figures come
 * from the `.rofl` and sit on a stored scrim: a side, ten players, no kill
 * participation. `ourSide` is the series game's own answer to "which side
 * were we", used when the scrim itself has not been told; without either,
 * nothing, because guessing the side would hand the series to one of theirs.
 */
export function mvpGameFromScrim(scrim: Scrim, ourSide?: 'blue' | 'red'): MvpGame | null {
  const side = scrim.ourSide ?? ourSide;
  if (!side) return null;
  const team = side === 'blue' ? 100 : 200;
  const ours = scrim.players.filter((p) => p.team === team);
  if (!ours.length) return null;
  return {
    players: ours.map((p) => ({
      name: p.name,
      position: p.position,
      champion: p.champion,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      damage: p.damage,
      cs: p.cs,
      damageTaken: p.damageTaken,
      visionScore: p.visionScore
    })),
    kills: { ours: ours.reduce((n, p) => n + p.kills, 0), theirs: scrim.players.filter((p) => p.team !== team).reduce((n, p) => n + p.kills, 0) },
    ...(scrim.durationSec ? { durationSec: scrim.durationSec } : {})
  };
}

/**
 * The figures behind one game of a series, whichever source has them: Riot's analysis when the match
 * reached it, otherwise the imported replay with the game's own side. Nothing when no `.rofl` has been
 * dropped on the game yet, which for a tournament custom is the normal state until somebody imports it.
 * Moved from Prep & Draft on 13 Sep 2026 so the home page crowns exactly the person Prep does.
 */
export function mvpGameOfSeriesGame(
  game: Pick<SeriesGame, 'matchId' | 'ourSide'>,
  analysisById: ReadonlyMap<string, MvpGame>,
  scrimById: ReadonlyMap<string, Scrim>
): MvpGame | null {
  if (!game.matchId) return null;
  const riot = analysisById.get(game.matchId);
  if (riot) return riot;
  const scrim = scrimById.get(game.matchId);
  return scrim ? mvpGameFromScrim(scrim, game.ourSide) : null;
}

/**
 * Who carried a series, from its games: each labelled "Game N", and the series' own length passed in
 * so the mark can say "1 of 3" rather than quietly averaging one game and calling it the series.
 */
export function seriesMvpOfGames(
  games: readonly Pick<SeriesGame, 'matchId' | 'ourSide' | 'gameNumber'>[],
  analysisById: ReadonlyMap<string, MvpGame>,
  scrimById: ReadonlyMap<string, Scrim>
): SeriesMvp | null {
  const read: SeriesMvpGame[] = [];
  for (const g of games) {
    const game = mvpGameOfSeriesGame(g, analysisById, scrimById);
    if (game) read.push({ label: `Game ${g.gameNumber}`, game });
  }
  return seriesMvpOf(read, games.length);
}
