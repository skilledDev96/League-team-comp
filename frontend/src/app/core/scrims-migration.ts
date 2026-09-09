import { Scrim, ScrimOpponent, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { slugOpponent, UNNAMED_OPPONENT } from './opponent-slug';
import { seatChampions } from './replay-parse';
import { DRAFT_LENGTH } from '../pages/tournaments/draft-sequence';

/**
 * The one-time move from the old Scrims page (9 Sep 2026): every scrim
 * opponent becomes a series in the scrims group, every replay a game on it.
 * Pure: it plans writes and never performs them, so the plan is testable and
 * a second run over the result plans nothing.
 */

export interface MigrationInput {
  scrims: readonly Scrim[];
  scrimOpponents: readonly ScrimOpponent[];
  tournaments: readonly Tournament[];
  series: readonly TournamentSeries[];
  games: readonly SeriesGame[];
  /** `name#tag` lowercased for everyone on our roster, to tell our side of an unsided replay. */
  rosterIds: ReadonlySet<string>;
}

export type MigrationWrite =
  | { kind: 'group-create'; tournament: Omit<Tournament, 'id' | 'order'> }
  | { kind: 'group-mark'; tournament: Tournament }
  | { kind: 'series'; slug: string; series: Omit<TournamentSeries, 'id' | 'order' | 'tournamentId'> }
  | { kind: 'game'; slug: string; scrimId: string; game: Omit<SeriesGame, 'id' | 'order' | 'seriesId'> }
  | { kind: 'scrim-side'; scrimId: string; ourSide: 'blue' | 'red' }
  | { kind: 'delete-opponent'; id: string };

export interface MigrationPlan {
  /** The scrims group as it is, or null when a write makes it. */
  group: Tournament | null;
  writes: MigrationWrite[];
  opponents: number;
  replays: number;
}

function sideOf(scrim: Scrim, ours: ReadonlySet<string>): 'blue' | 'red' | null {
  if (scrim.ourSide) return scrim.ourSide;
  const mine = (team: number) => scrim.players.filter((p) => p.team === team && ours.has(`${p.name}#${p.tag}`.toLowerCase())).length;
  const blue = mine(100);
  const red = mine(200);
  if (blue === red) return null;
  return blue > red ? 'blue' : 'red';
}

/** The scrims group: by kind, then by the name "Draft against them" used, else nothing. */
export function scrimsGroupOf(tournaments: readonly Tournament[]): Tournament | undefined {
  return tournaments.find((t) => t.kind === 'scrims') ?? tournaments.find((t) => t.name.trim().toLowerCase() === 'scrims');
}

export function planScrimsMigration(input: MigrationInput): MigrationPlan {
  const writes: MigrationWrite[] = [];
  let group = scrimsGroupOf(input.tournaments) ?? null;
  if (group && group.kind !== 'scrims') {
    writes.push({ kind: 'group-mark', tournament: { ...group, kind: 'scrims', fearless: false, name: 'Scrims' } });
  }
  if (!group) {
    writes.push({ kind: 'group-create', tournament: { name: 'Scrims', kind: 'scrims', fearless: false, notes: 'Every team we scrim. Not a tournament: no dates, no best-of, nothing burns.' } });
  }

  // Which slugs already have a series in the group.
  const inGroup = group ? input.series.filter((s) => s.tournamentId === group!.id) : [];
  const bySlug = new Map(inGroup.map((s) => [slugOpponent(s.opponent), s]));
  const linked = new Set(input.games.map((g) => g.matchId).filter((id): id is string => !!id));

  // The opponents: every record, plus every name a replay carries.
  const names = new Map<string, string>();
  for (const o of input.scrimOpponents) names.set(o.id, o.name);
  for (const s of input.scrims) {
    const slug = slugOpponent(s.opponent);
    if (!names.has(slug)) names.set(slug, s.opponent?.trim() || UNNAMED_OPPONENT);
  }
  // Replays that are already someone's game need no opponent of their own.
  const wanted = new Set<string>();
  for (const s of input.scrims) if (!linked.has(s.id)) wanted.add(slugOpponent(s.opponent));
  for (const o of input.scrimOpponents) wanted.add(o.id);

  let opponents = 0;
  for (const slug of wanted) {
    if (bySlug.has(slug)) continue;
    const record = input.scrimOpponents.find((o) => o.id === slug);
    // A tournament series against the same team lends what it knows.
    const lent = input.series.find((s) => slugOpponent(s.opponent) === slug && (s.opponentPlayers?.length || s.bans?.length || s.notes));
    writes.push({
      kind: 'series',
      slug,
      series: {
        opponent: names.get(slug) ?? UNNAMED_OPPONENT,
        bestOf: 0,
        status: 'scheduled',
        ...(record?.notes ?? lent?.notes ? { notes: record?.notes ?? lent?.notes } : {}),
        ...(record?.bans ?? lent?.bans ? { bans: record?.bans ?? lent?.bans } : {}),
        ...(record?.opponentPlayers ?? lent?.opponentPlayers ? { opponentPlayers: record?.opponentPlayers ?? lent?.opponentPlayers } : {}),
        ...(record?.teamHistory ?? lent?.teamHistory ? { teamHistory: record?.teamHistory ?? lent?.teamHistory } : {})
      }
    });
    opponents += 1;
  }

  // The replays: one game each, numbered by when they were played, per opponent.
  const byOpponent = new Map<string, Scrim[]>();
  for (const s of [...input.scrims].sort((a, b) => a.playedOn.localeCompare(b.playedOn))) {
    if (linked.has(s.id)) continue;
    const slug = slugOpponent(s.opponent);
    byOpponent.set(slug, [...(byOpponent.get(slug) ?? []), s]);
  }
  let replays = 0;
  for (const [slug, list] of byOpponent) {
    const existing = bySlug.get(slug);
    let number = existing ? input.games.filter((g) => g.seriesId === existing.id).length : 0;
    for (const scrim of list) {
      number += 1;
      const side = sideOf(scrim, input.rosterIds);
      if (side && !scrim.ourSide) writes.push({ kind: 'scrim-side', scrimId: scrim.id, ourSide: side });
      const team = side === 'blue' ? 100 : 200;
      writes.push({
        kind: 'game',
        slug,
        scrimId: scrim.id,
        game: side
          ? {
              gameNumber: number,
              ourChampions: seatChampions(scrim.players, team),
              theirChampions: seatChampions(scrim.players, team === 100 ? 200 : 100),
              ourSide: side,
              win: side === 'blue' ? scrim.blueWon : !scrim.blueWon,
              matchId: scrim.id,
              draftStep: DRAFT_LENGTH
            }
          : { gameNumber: number, ourChampions: [], theirChampions: [], matchId: scrim.id }
      });
      replays += 1;
    }
  }

  for (const o of input.scrimOpponents) writes.push({ kind: 'delete-opponent', id: o.id });

  return { group, writes, opponents, replays };
}

/** True when there is nothing left to move. */
export function migrationDone(plan: MigrationPlan): boolean {
  return plan.writes.every((w) => w.kind === 'group-mark' || w.kind === 'group-create') && plan.opponents === 0 && plan.replays === 0;
}
