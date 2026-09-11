import { Role, ROLES, Scrim } from '../models/team.models';

/**
 * Who carried a game, and who carried a series (11 Sep 2026, queue items 5
 * and 6).
 *
 * The film's poster has picked a seat off this line since 9 Sep 2026
 * (`core/film-build.ts`, `mvpSeat`); the lead asked for it to become a thing
 * on screen, on the game row, on the film's card and on the series head in
 * Prep & Draft. So the arithmetic lives here, once, with the terms that
 * carried it in words, because nobody should have to trust a number they
 * cannot see the parts of. Nothing here is ever called a score on screen:
 * the chip says MVP and then the terms.
 *
 * The shape is structural on purpose. An analysed Riot game, a replay's five
 * and a game row all carry the same handful of figures under different
 * names, and every one of the three surfaces has a different one of them; a
 * caller maps its own rows onto `MvpPlayer` and the arithmetic is the same
 * for all three.
 *
 * `mvpSeatOf` is `film-build`'s own `mvpSeat`, lifted unchanged so the
 * poster keeps choosing exactly the seat it chose before: the same weights,
 * the same `?? 0` for a missing kill participation, the same tie to lane
 * order. `film-build.ts` imports it, so the film's face and the chip can
 * never name two seats.
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
  /** Share of the team's kills this seat was in on, 0-1. Absent on a replay. */
  killParticipation?: number;
}

/** A game as this module needs it: our five, and the team's kills when the source counted them. */
export interface MvpGame {
  players: readonly MvpPlayer[];
  kills?: { ours: number; theirs: number };
}

export interface GameMvp {
  seat: Role;
  /** Our roster member, when the game named one. */
  name?: string;
  champion: string;
  /** The weights behind the pick. Never shown: on screen this is "MVP" and the terms. */
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
  /** The average of the game points over the games this seat played. Never shown. */
  points: number;
  /** How many games of the series this seat played. */
  games: number;
  /** One line a game: "Game 2 on Jinx: 52.5k damage, 38% of ours · on 14 of 20 kills · died twice". */
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

/** 52 500 as "52.5k", 640 as "640". Damage is read at a glance, not audited. */
function figure(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

/** "died twice" is a phrase; "died 2 times" is not. Past five it is a digit again. */
const DEATH_WORDS = ['never died', 'died once', 'died twice', 'died three times', 'died four times', 'died five times'];
function deathsTerm(deaths: number): string {
  return DEATH_WORDS[deaths] ?? `died ${deaths} times`;
}

function killsTerm(kills: number, assists: number): string {
  const k = kills ? `${kills} ${kills === 1 ? 'kill' : 'kills'}` : '';
  const a = assists ? `${assists} ${assists === 1 ? 'assist' : 'assists'}` : '';
  if (k && a) return `${k} and ${a}`;
  return k || a || 'no kills or assists';
}

/** One seat's line, scored and said. Internal: the exported entries hand back only what a surface shows. */
interface MvpLine {
  seat: Role;
  name?: string;
  champion: string;
  points: number;
  /** Share of the team's damage, 0-1; 0 when the game carries no damage at all, and then no damage term is claimed. */
  share: number;
  why: string[];
}

/**
 * Every seat of ours with its points and its terms, best first.
 *
 * The weights are `film-build`'s: three a kill, one and a half an assist,
 * two off a death, twelve times the share of the team's damage, six times
 * kill participation. Ties go to lane order, exactly as the poster's pick
 * did, so the film's face does not move.
 */
function linesOf(game: MvpGame): MvpLine[] {
  const players = game.players ?? [];
  const teamDamage = players.reduce((sum, p) => sum + (p.damage ?? 0), 0);
  const teamKills = game.kills?.ours ?? players.reduce((sum, p) => sum + p.kills, 0);
  const lines: MvpLine[] = [];
  for (const p of players) {
    const seat = seatOfPosition(p.position);
    // A source that used a word we do not know is left out rather than filed under a seat it might not be.
    if (!seat) continue;
    const share = teamDamage ? (p.damage ?? 0) / teamDamage : 0;
    const points = p.kills * 3 + p.assists * 1.5 - p.deaths * 2 + share * 12 + (p.killParticipation ?? 0) * 6;
    const line: MvpLine = { seat, champion: p.champion ?? '', points, share, why: whyOf(p, share, teamDamage, teamKills) };
    if (p.name) line.name = p.name;
    lines.push(line);
  }
  return lines.sort((a, b) => b.points - a.points || seatIndex(a.seat) - seatIndex(b.seat));
}

/**
 * The two or three terms behind a line, in the order they carry it: the
 * damage, what share of our kills they were in on, and what it cost. A term
 * the game has no figures for is not written at all — a replay carries no
 * kill participation, so it says "on 9 of 21 kills" off the kills and
 * assists it does carry, and a game with no damage figures says nothing
 * about damage rather than "0, 0% of ours".
 */
function whyOf(p: MvpPlayer, share: number, teamDamage: number, teamKills: number): string[] {
  const terms: string[] = [];
  if (teamDamage > 0 && typeof p.damage === 'number') terms.push(`${figure(p.damage)} damage, ${Math.round(share * 100)}% of ours`);
  if (teamKills > 0) {
    // Riot's own participation when the source has it, else the kills and assists against the team's kills, which is the same count.
    const on = typeof p.killParticipation === 'number' ? Math.round(p.killParticipation * teamKills) : p.kills + p.assists;
    terms.push(`on ${Math.min(on, teamKills)} of ${teamKills} kills`);
  } else if (typeof p.killParticipation === 'number') {
    terms.push(`in on ${Math.round(p.killParticipation * 100)}% of our kills`);
  } else {
    terms.push(killsTerm(p.kills, p.assists));
  }
  terms.push(deathsTerm(p.deaths));
  return terms;
}

/**
 * The seat the poster fronts. `film-build`'s `mvpSeat`, unchanged: a game
 * with no player in a seat we know hands back nothing.
 */
export function mvpSeatOf(game: MvpGame | undefined | null): Role | undefined {
  return game ? linesOf(game)[0]?.seat : undefined;
}

/** Who carried the game, with the terms that carried it; nothing for a game with no seats we can read. */
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
 * to the better average share of our damage, then to lane order.
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
export function seriesMvpOf(games: readonly SeriesMvpGame[]): SeriesMvp | null {
  const running = new Map<Role, { names: Set<string>; champion: string; bestPoints: number; points: number; share: number; games: number; why: string[] }>();
  for (const { label, game } of games) {
    for (const line of linesOf(game)) {
      const seat = running.get(line.seat) ?? { names: new Set<string>(), champion: line.champion, bestPoints: Number.NEGATIVE_INFINITY, points: 0, share: 0, games: 0, why: [] };
      seat.points += line.points;
      seat.share += line.share;
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
    .map(([seat, r]) => ({ seat, ...r, average: r.points / r.games, averageShare: r.share / r.games }))
    .sort((a, b) => b.average - a.average || b.averageShare - a.averageShare || seatIndex(a.seat) - seatIndex(b.seat))[0];
  if (!best) return null;
  const mvp: SeriesMvp = {
    seat: best.seat,
    champion: best.champion,
    points: best.average,
    games: best.games,
    why: best.why,
    line: best.games === 1 ? 'Best line of the one game played so far.' : `Best line per game across the ${best.games} games played.`
  };
  const [only] = [...best.names];
  if (best.names.size === 1 && only) mvp.name = only;
  return mvp;
}

/** One of our seats on a game row, whichever of the three sources the row came from. Structural, so `pages/games/game-rows.ts` fits without core knowing about it. */
export interface MvpRowPlayer {
  role: string;
  champion: string;
  /** Our roster member, or null for a teammate who is not on it. */
  player: string | null;
  /** Absent on a tournament game typed in by hand: ten champions and a result, no figures. */
  stats?: { kills: number; deaths: number; assists: number; damage?: number; killParticipation?: number };
}

/**
 * A game row as a line-up this module can read (11 Sep 2026). A row with no
 * figures on any seat comes back with nobody in it, and the row's chip is
 * simply not drawn — a tournament game we typed in knows who played what and
 * nothing else, and inventing an MVP off five champions would be a lie.
 */
export function mvpGameFromRow(row: { ours: readonly MvpRowPlayer[]; kills?: { ours: number; theirs: number } }): MvpGame {
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
      ...(typeof p.stats!.killParticipation === 'number' ? { killParticipation: p.stats!.killParticipation } : {})
    }));
  return { players, ...(row.kills ? { kills: row.kills } : {}) };
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
    players: ours.map((p) => ({ name: p.name, position: p.position, champion: p.champion, kills: p.kills, deaths: p.deaths, assists: p.assists, damage: p.damage })),
    kills: { ours: ours.reduce((n, p) => n + p.kills, 0), theirs: scrim.players.filter((p) => p.team !== team).reduce((n, p) => n + p.kills, 0) }
  };
}
