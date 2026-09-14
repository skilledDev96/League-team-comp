import { ChampionTraits, Comp, CompExpectation, CompGamePlan, CompRecord, CompResult, GameReview, Play, Player, Role, ROLES } from '../models/team.models';
import { GameRow } from '../pages/games/game-rows';
import { championOf, noteOf } from '../shared/comp-board.util';
import { expectationFor } from './comp-expectation';
import { resolveAlias } from './comp-alias';
import { classifyComp, compIconFor, CompIdentity, damageProfile, DamageProfile, IDENTITY_LABEL } from './comp-identity';
import { rateBand } from './opponent-view';

/**
 * The Comps page as one model (13 Sep 2026, the `buildRoster` pattern): every comp's five, its shape, what it
 * expects, its record and its plays, built once and read by the tile and the sheet alike, so the two cannot say
 * different things about one comp.
 *
 * A comp's games are the rows `buildGameRows` already placed under it (`row.compId`, through `effectiveComp`,
 * overrides and counts-under applied) — the same games Home's comp of the month and `/games?comp=` count, and
 * not the backend's own per-comp tally, so no surface can disagree with another. Logged results beat played
 * games for the headline, as the page always had it.
 *
 * Pure: the page hands in the store's signals and two trait lookups, and reads back the cards.
 */

/** How many of the newest results a tile's form strip shows. */
export const COMP_FORM_GAMES = 5;

export interface CompSeat {
  role: Role;
  /** The champion as the comp writes it; '' for an empty seat. */
  champion: string;
  note: string;
  /** Who on the roster can play the seat: the main first, then anyone who flexes into it. */
  cover: { name: string; flex: boolean }[];
}

/** The games that counted under the comp. */
export interface CompPlayed {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Newest first, at most `COMP_FORM_GAMES`. */
  form: ('W' | 'L')[];
  /** Epoch ms of the newest dated game, or null. */
  lastPlayed: number | null;
}

/** The record the tile and the sheet head print: the logged one when there is one, else the played one. */
export interface CompHeadline {
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  /** `rateBand` class: is-good, is-ok, is-even, is-poor. */
  band: string;
  source: 'logged' | 'played';
}

/** What the post-game reviews said about the games that counted under the comp. */
export interface CompReviewed {
  reviewed: number;
  asDrafted: number;
  offPlan: number;
  unclear: number;
  /** Up to three reasons the reviews gave for going off plan. */
  offPlanWhy: string[];
}

/** A match note written on one of the comp's games (the shape `rollupNotes` reads). */
export interface CompGameNote {
  matchId: string;
  text: string;
  win: boolean;
  date?: number;
}

export interface CompCard {
  id: string;
  name: string;
  category: string | null;
  order: number;
  seats: CompSeat[];
  /** How many seats hold a champion. */
  filled: number;
  /** All five seats hold one. */
  complete: boolean;
  identity: CompIdentity;
  /** The shape in words, or "Building" until five are in. */
  identityLabel: string;
  /** The material symbol for the shape, from the traits and then the name (`compIconFor`). */
  icon: string;
  damage: DamageProfile;
  /** The champion whose splash stands for the comp; null on an empty comp. */
  face: string | null;
  expect: { expect: CompExpectation; source: 'derived' | 'edited' } | null;
  logged: CompRecord | null;
  played: CompPlayed | null;
  headline: CompHeadline | null;
  lastPlayed: number | null;
  plays: Play[];
  bans: string[];
  notes: string;
  gamePlan: CompGamePlan;
  countsUnder: string | null;
  /** The name of the comp this one counts under, when it does and that comp exists. */
  countsUnderName: string | null;
  /** The comps that count under this one. */
  variants: { id: string; name: string }[];
  reviewed: CompReviewed | null;
  gameNotes: CompGameNote[];
}

export interface CompsModel {
  /** In the comps' own order. */
  cards: CompCard[];
  /** Every category in use, sorted. */
  categories: string[];
  /** How many games on the books count under some comp. */
  onRecord: number;
}

export interface CompsInput {
  comps: readonly Comp[];
  compResults: readonly CompResult[];
  plays: readonly Play[];
  players: readonly Player[];
  gameReviews: readonly GameReview[];
  /** Every game, from `buildGameRows`; the comp each counts under is on the row. */
  rows: readonly GameRow[];
  /** The match note on a Riot game, or ''. */
  matchNote: (matchId: string) => string;
  traitsOf: (comp: Comp) => ChampionTraits[];
  junglerIdOf: (comp: Comp) => string | undefined;
}

/** Who on the roster covers a seat: the player whose main it is first, then whoever flexes into it. */
export function coverOf(players: readonly Player[], role: Role): { name: string; flex: boolean }[] {
  const byOrder = [...players].sort((a, b) => a.order - b.order);
  return [
    ...byOrder.filter((p) => p.role === role).map((p) => ({ name: p.name, flex: false })),
    ...byOrder.filter((p) => p.role !== role && (p.secondaryRoles ?? []).includes(role)).map((p) => ({ name: p.name, flex: true }))
  ];
}

/** The five champions a card holds, empty seats left out. */
export function championsOf(card: Pick<CompCard, 'seats'>): string[] {
  return card.seats.map((s) => s.champion).filter(Boolean);
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Which seat's splash stands for the comp: the one its name names, else the seat its shape turns on, else the first filled. */
const FACE_SEAT: Record<CompIdentity, Role> = { dive: 'Jungle', pick: 'Jungle', protect: 'ADC', poke: 'ADC', split: 'Top', teamfight: 'Mid', unclear: 'Mid' };

/**
 * The champion whose splash stands for the comp. A name that names one of its champions wins ("Jinx protect"),
 * whole words or four letters and more — so "Vi" is not read into "Dive"; else the seat the comp's shape turns
 * on; else the first seat with a champion; null on an empty comp.
 */
export function faceOf(card: Pick<CompCard, 'seats' | 'name' | 'identity'>): string | null {
  const filled = card.seats.filter((s) => s.champion);
  if (!filled.length) return null;
  const words = card.name.split(/[^A-Za-z0-9']+/).map(key).filter(Boolean);
  const whole = key(card.name);
  const named = filled.find((s) => {
    const k = key(s.champion);
    return k.length > 0 && (words.includes(k) || (k.length >= 4 && whole.includes(k)));
  });
  if (named) return named.champion;
  const bySeat = filled.find((s) => s.role === FACE_SEAT[card.identity]);
  return (bySeat ?? filled[0]).champion;
}

/**
 * Where the sheet's full-width cell goes so it sits under the row holding tile `i`: after the last cell of that
 * row, or after the last cell of all when the row is the last and not full.
 */
export function sheetAfterIndex(i: number, cols: number, cells: number): number {
  const c = Math.max(1, cols);
  return Math.min(Math.floor(i / c) * c + c - 1, Math.max(0, cells - 1));
}

function loggedOf(results: readonly CompResult[]): CompRecord | null {
  if (!results.length) return null;
  const wins = results.filter((r) => r.outcome === 'win').length;
  return {
    games: results.length,
    wins,
    losses: results.length - wins,
    winRate: Math.round((wins / results.length) * 100),
    results: [...results].sort((a, b) => b.order - a.order)
  };
}

function playedOf(rows: readonly GameRow[]): CompPlayed | null {
  if (!rows.length) return null;
  const newest = [...rows].sort((a, b) => b.date - a.date);
  const wins = rows.filter((r) => r.win).length;
  const dated = rows.filter((r) => r.date > 0);
  return {
    games: rows.length,
    wins,
    losses: rows.length - wins,
    winRate: Math.round((wins / rows.length) * 100),
    form: newest.slice(0, COMP_FORM_GAMES).map((r) => (r.win ? 'W' : 'L')),
    lastPlayed: dated.length ? Math.max(...dated.map((r) => r.date)) : null
  };
}

function headlineOf(logged: CompRecord | null, played: CompPlayed | null): CompHeadline | null {
  const pick = logged ? { ...logged, source: 'logged' as const } : played ? { ...played, source: 'played' as const } : null;
  if (!pick) return null;
  return {
    games: pick.games,
    wins: pick.wins,
    losses: pick.losses,
    winRate: pick.winRate,
    band: rateBand({ champion: '', games: pick.games, wins: pick.wins }),
    source: pick.source
  };
}

/**
 * The reviews of a comp's games that were reviewed as this comp (14 Sep 2026). A game sits under a comp by
 * its row, but the review names the comp it read on its own, and one with no comp (or another comp) says
 * nothing about whether this one played out as drafted: counting it printed "0 of 1 reviewed" on a comp
 * no review was about. A review naming a variant counts under the comp the variant counts under.
 */
export function reviewedOf(compId: string, comps: readonly Comp[], rows: readonly GameRow[], reviews: readonly GameReview[]): CompReviewed | null {
  const ids = new Set(rows.map((r) => r.matchId).filter((id): id is string => !!id));
  const all = [...comps];
  const ours = reviews.filter((r) => ids.has(r.matchId) && !!r.compId && (r.compId === compId || resolveAlias(r.compId, all) === compId));
  if (!ours.length) return null;
  const by = (verdict: GameReview['team']['compVerdict']) => ours.filter((r) => r.team.compVerdict === verdict);
  return {
    reviewed: ours.length,
    asDrafted: by('as drafted').length,
    offPlan: by('off plan').length,
    unclear: by('unclear').length,
    offPlanWhy: by('off plan')
      .map((r) => r.team.compWhy)
      .filter(Boolean)
      .slice(0, 3)
  };
}

export function buildComps(i: CompsInput): CompsModel {
  const comps = [...i.comps].sort((a, b) => a.order - b.order);
  const nameOf = new Map(comps.map((c) => [c.id, c.name]));
  const rowsBy = new Map<string, GameRow[]>();
  for (const r of i.rows) {
    if (!r.compId || !nameOf.has(r.compId)) continue;
    rowsBy.set(r.compId, [...(rowsBy.get(r.compId) ?? []), r]);
  }
  const cover = new Map(ROLES.map((role) => [role, coverOf(i.players, role)]));

  const cards = comps.map((comp): CompCard => {
    const seats = ROLES.map((role): CompSeat => {
      const line = comp.picks[role] ?? '';
      return { role, champion: championOf(line), note: noteOf(line), cover: cover.get(role) ?? [] };
    });
    const filled = seats.filter((s) => s.champion).length;
    const complete = filled === ROLES.length;
    const traits = i.traitsOf(comp);
    const identity: CompIdentity = complete && traits.length === ROLES.length ? classifyComp(traits) : 'unclear';
    const rows = rowsBy.get(comp.id) ?? [];
    const logged = loggedOf(i.compResults.filter((r) => r.compId === comp.id));
    const played = playedOf(rows);
    const base = { seats, name: comp.name, identity };
    return {
      id: comp.id,
      name: comp.name,
      category: comp.category?.trim() || null,
      order: comp.order,
      seats,
      filled,
      complete,
      identity,
      identityLabel: complete ? IDENTITY_LABEL[identity] : 'Building',
      icon: compIconFor(traits, comp.name),
      damage: damageProfile(traits),
      face: faceOf(base),
      expect: expectationFor(comp, traits, i.junglerIdOf(comp)),
      logged,
      played,
      headline: headlineOf(logged, played),
      lastPlayed: played?.lastPlayed ?? null,
      plays: i.plays.filter((p) => p.compId === comp.id).sort((a, b) => a.order - b.order),
      bans: comp.bans ?? [],
      notes: comp.notes ?? '',
      gamePlan: comp.gamePlan ?? {},
      countsUnder: comp.countsUnder ?? null,
      countsUnderName: comp.countsUnder ? (nameOf.get(comp.countsUnder) ?? null) : null,
      variants: comps.filter((c) => c.countsUnder === comp.id).map((c) => ({ id: c.id, name: c.name })),
      reviewed: reviewedOf(comp.id, comps, rows, i.gameReviews),
      gameNotes: rows
        .filter((r) => r.matchId)
        .map((r) => ({ matchId: r.matchId!, text: i.matchNote(r.matchId!), win: r.win, ...(r.date > 0 ? { date: r.date } : {}) }))
        .filter((n) => n.text)
    };
  });

  return {
    cards,
    categories: [...new Set(cards.map((c) => c.category).filter((c): c is string => !!c))].sort(),
    onRecord: [...rowsBy.values()].reduce((n, rows) => n + rows.length, 0)
  };
}
