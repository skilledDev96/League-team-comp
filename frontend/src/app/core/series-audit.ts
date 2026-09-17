import { Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { isNoBan } from '../pages/tournaments/draft-sequence';
import { canonicalChampion } from './champion-key';
import { parseLocalDate } from './local-date';
import { isDecided, seriesScoreOf } from './series-results';

/**
 * What a series' stored games say that cannot be true, and what an import would add to it (17 Sep 2026).
 *
 * MAD Synergy's Bo3 read 0–3 with "27 burned" from thirty picks: Pantheon theirs in game 1 and game 2,
 * Malphite theirs in game 1 and ours in game 2, and one 36:41 game listed as both Bo3 game 1 and a
 * scrim against MOSS 2. The burned lists count a champion once by key, so the page drew a tidy pool
 * over a series that could not have been played, and nothing on screen said so. The data was repaired
 * on 14 Sep 2026 and the importer already refuses a replay another game holds (`replayClaim`); this is
 * the check that makes the next such mistake visible, and the question asked before an import makes one.
 *
 * Pure: the Plan's series head, Admin › Diagnostics and both import paths read the same answer. The
 * words name the opponent and game numbers and never a player of either side.
 */

export type SeriesAuditKind = 'repeat' | 'afterDecided' | 'overCap' | 'duplicate' | 'dateMismatch' | 'draftMismatch';

export interface SeriesFinding {
  kind: SeriesAuditKind;
  seriesId: string;
  /** The games it is about: this series' first, in game order, then any other series' it shares a replay with. */
  gameIds: string[];
  /** The champion a repeat is about, in the spelling first stored. */
  champion?: string;
  /** One sentence: the opponent, the game numbers and what does not add up. */
  text: string;
}

export interface SeriesAuditSources {
  tournaments: readonly Pick<Tournament, 'id' | 'kind' | 'fearless' | 'order'>[];
  series: readonly Pick<TournamentSeries, 'id' | 'tournamentId' | 'opponent' | 'bestOf' | 'scheduledAt' | 'sandbox' | 'order'>[];
  seriesGames: readonly SeriesGame[];
  scrims: readonly Pick<Scrim, 'id' | 'playedOn' | 'durationSec' | 'players'>[];
  /** How a champion reads in the words ("Wukong" for "MonkeyKing"); the stored spelling when absent. */
  championName?: (champion: string) => string;
}

/** A full draft: five picks a side. A pick log shorter than this is a draft still running, not one to compare. */
export const DRAFT_PICKS = 10;

/** Of the ten, how many a replay has to share with the draft run in the room to be that game's replay. */
export const DRAFT_MATCH_MIN = 8;

/** Two replays this close in length, with the same ten champions, are one game filed twice. */
export const SAME_LENGTH_SEC = 2;

/** Days before a series' date a replay file may be dated before it reads as another day's game. */
export const DATE_SLACK_DAYS = 2;

type Side = 'our' | 'their';
type AuditSeries = SeriesAuditSources['series'][number];

/** The champions of a list, without the empty seats and the ban nobody saw ('-' is never a champion). */
function champions(list: readonly (string | undefined)[] | undefined): string[] {
  return (list ?? []).filter((c): c is string => !!c && !isNoBan(c));
}

function keysOf(list: readonly (string | undefined)[] | undefined): Set<string> {
  return new Set(champions(list).map(canonicalChampion).filter(Boolean));
}

const byGameNumber = (a: Pick<SeriesGame, 'gameNumber'>, b: Pick<SeriesGame, 'gameNumber'>) => a.gameNumber - b.gameNumber;

/** "a", "a and b", "a, b and c". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "G1", "G1 and G2", once each and in order. */
function gamesWords(numbers: readonly number[]): string {
  return andList([...new Set(numbers)].sort((a, b) => a - b).map((n) => `G${n}`));
}

function times(n: number): string {
  return n === 2 ? 'twice' : n === 3 ? 'three times' : `${n} times`;
}

function clock(sec: number): string {
  const whole = Math.round(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function opponentOf(series: Pick<TournamentSeries, 'opponent'> | undefined): string {
  return series?.opponent?.trim() || 'An unnamed opponent';
}

/**
 * Whether picks burn across a series: the rule `TournamentContextService.isFearless` has always read. A
 * series whose group is missing counts as fearless there, so it does here.
 */
export function isFearlessSeries(
  series: Pick<TournamentSeries, 'tournamentId'>,
  tournaments: readonly Pick<Tournament, 'id' | 'kind' | 'fearless'>[]
): boolean {
  const group = tournaments.find((t) => t.id === series.tournamentId);
  if (!group) return true;
  return group.kind === 'scrims' ? false : group.fearless !== false;
}

/**
 * How many of the champions a replay carries were in the pick log the draft room kept, or null when
 * the log does not hold a full draft (a game typed on the Plan, or drafted before the log existed) or
 * the replay names nobody.
 */
export function draftOverlap(pickLog: readonly string[] | undefined, replayChampions: readonly string[]): number | null {
  const logged = keysOf(pickLog);
  if (logged.size < DRAFT_PICKS) return null;
  const replay = keysOf(replayChampions);
  if (!replay.size) return null;
  let shared = 0;
  for (const key of logged) if (replay.has(key)) shared += 1;
  return shared;
}

// ---- The audit ----------------------------------------------------------------------------------

/** Every finding over the team's series, in schedule order. Sandbox series are skipped whole. */
export function auditSeries(i: SeriesAuditSources): SeriesFinding[] {
  const name = (champion: string) => i.championName?.(champion) ?? champion;
  const groupOrder = new Map(i.tournaments.map((t) => [t.id, t.order ?? 0]));
  const live = i.series
    .filter((s) => s.sandbox !== true)
    .map((s, index) => ({ s, index }))
    .sort(
      (a, b) =>
        (groupOrder.get(a.s.tournamentId) ?? 0) - (groupOrder.get(b.s.tournamentId) ?? 0) ||
        (a.s.order ?? 0) - (b.s.order ?? 0) ||
        a.index - b.index
    )
    .map((x) => x.s);
  const seriesById = new Map(live.map((s) => [s.id, s]));
  const gamesBySeries = new Map<string, SeriesGame[]>(live.map((s) => [s.id, []]));
  for (const game of i.seriesGames) gamesBySeries.get(game.seriesId)?.push(game);
  for (const games of gamesBySeries.values()) games.sort(byGameNumber);
  const scrimById = new Map(i.scrims.map((s) => [s.id, s]));
  const duplicates = duplicateFindings([...gamesBySeries.values()].flat(), seriesById, scrimById);

  const out: SeriesFinding[] = [];
  for (const series of live) {
    const games = gamesBySeries.get(series.id) ?? [];
    out.push(...(duplicates.get(series.id) ?? []));
    out.push(...draftMismatches(series, games, scrimById));
    if (isFearlessSeries(series, i.tournaments)) out.push(...repeats(series, games, name));
    const after = afterDecided(series, games);
    if (after) out.push(after);
    const over = overCap(series, games);
    if (over) out.push(over);
    const dates = dateMismatch(series, games, scrimById);
    if (dates) out.push(dates);
  }
  return out;
}

/**
 * A champion twice in one fearless series: in two games, or on both sides of one. Only fearless
 * series, because a scrim block plays a champion as often as it likes.
 */
function repeats(series: AuditSeries, games: readonly SeriesGame[], name: (c: string) => string): SeriesFinding[] {
  const seen = new Map<string, { champion: string; hits: { game: SeriesGame; side: Side }[] }>();
  for (const game of games) {
    for (const side of ['our', 'their'] as const) {
      for (const champion of champions(side === 'our' ? game.ourChampions : game.theirChampions)) {
        const key = canonicalChampion(champion);
        if (!key) continue;
        const entry = seen.get(key) ?? { champion, hits: [] };
        entry.hits.push({ game, side });
        seen.set(key, entry);
      }
    }
  }
  const out: SeriesFinding[] = [];
  for (const { champion, hits } of seen.values()) {
    if (hits.length < 2) continue;
    const gameIds = [...new Set(hits.map((h) => h.game.id))];
    const replay = hits.some((h) => !!h.game.matchId);
    out.push({
      kind: 'repeat',
      seriesId: series.id,
      gameIds,
      champion,
      text: `${opponentOf(series)} ${gamesWords(hits.map((h) => h.game.gameNumber))}: ${name(champion)} ${repeatWhere(hits)}.${replay ? ' Wrong replay?' : ''}`
    });
  }
  return out;
}

/** "on their side twice", "on both sides", "on their side in G1 and ours in G2". */
function repeatWhere(hits: readonly { game: Pick<SeriesGame, 'id' | 'gameNumber'>; side: Side }[]): string {
  const first = hits[0].side;
  if (hits.every((h) => h.side === first)) return `on ${first} side ${times(hits.length)}`;
  if (hits.length === 2 && hits[0].game.id === hits[1].game.id) return 'on both sides';
  const on = (side: Side) => gamesWords(hits.filter((h) => h.side === side).map((h) => h.game.gameNumber));
  const other: Side = first === 'our' ? 'their' : 'our';
  return `on ${first} side in ${on(first)} and ${other === 'our' ? 'ours' : 'theirs'} in ${on(other)}`;
}

/** Games with a result recorded after the best-of was already decided by the ones before them. */
function afterDecided(series: AuditSeries, games: readonly SeriesGame[]): SeriesFinding | null {
  if (!(series.bestOf > 0)) return null;
  const before: SeriesGame[] = [];
  const late: SeriesGame[] = [];
  let decidedAt: { wins: number; losses: number } | null = null;
  for (const game of games) {
    if (game.win === undefined) continue;
    const score = seriesScoreOf(before);
    if (isDecided(series.bestOf, score)) {
      late.push(game);
      decidedAt ??= score;
    }
    before.push(game);
  }
  if (!late.length || !decidedAt) return null;
  return {
    kind: 'afterDecided',
    seriesId: series.id,
    gameIds: late.map((g) => g.id),
    text: `${opponentOf(series)} ${gamesWords(late.map((g) => g.gameNumber))}: ${late.length === 1 ? 'a result' : 'results'} after the Bo${series.bestOf} was already decided at ${decidedAt.wins}–${decidedAt.losses}.`
  };
}

/** More games than the best-of holds. A scrim block has no cap. */
function overCap(series: AuditSeries, games: readonly SeriesGame[]): SeriesFinding | null {
  if (!(series.bestOf > 0) || games.length <= series.bestOf) return null;
  const extra = games.slice(series.bestOf);
  return {
    kind: 'overCap',
    seriesId: series.id,
    gameIds: extra.map((g) => g.id),
    text: `${opponentOf(series)} ${gamesWords(extra.map((g) => g.gameNumber))}: ${games.length} games in a Bo${series.bestOf}.`
  };
}

/**
 * One game on two series games: the same replay id, or two replays with the same ten champions and the
 * same length. Said once for each series involved, so each series head carries it.
 */
function duplicateFindings(
  games: readonly SeriesGame[],
  seriesById: ReadonlyMap<string, AuditSeries>,
  scrimById: ReadonlyMap<string, Pick<Scrim, 'durationSec' | 'players'>>
): Map<string, SeriesFinding[]> {
  const out = new Map<string, SeriesFinding[]>();
  const add = (group: readonly SeriesGame[], sentence: (label: string) => string) => {
    for (const seriesId of [...new Set(group.map((g) => g.seriesId))]) {
      const ordered = [...group.filter((g) => g.seriesId === seriesId).sort(byGameNumber), ...group.filter((g) => g.seriesId !== seriesId)];
      const bySeries = [...new Set(ordered.map((g) => g.seriesId))].map(
        (id) => `${opponentOf(seriesById.get(id))} ${gamesWords(ordered.filter((g) => g.seriesId === id).map((g) => g.gameNumber))}`
      );
      const list = out.get(seriesId) ?? [];
      list.push({ kind: 'duplicate', seriesId, gameIds: ordered.map((g) => g.id), text: sentence(andList(bySeries)) });
      out.set(seriesId, list);
    }
  };

  const byMatch = new Map<string, SeriesGame[]>();
  for (const game of games) {
    if (!game.matchId) continue;
    byMatch.set(game.matchId, [...(byMatch.get(game.matchId) ?? []), game]);
  }
  for (const group of byMatch.values()) {
    if (group.length > 1) add(group, (label) => `${label} carry the same replay.`);
  }

  // The same game under two ids: ten champions alike and the length within a couple of seconds.
  const read = [...byMatch.entries()]
    .map(([matchId, group]) => {
      const scrim = scrimById.get(matchId);
      const ten = champions((scrim?.players ?? []).map((p) => p.champion)).map(canonicalChampion).filter(Boolean).sort();
      return { matchId, game: group[0], group, ten: ten.join('|'), length: ten.length, sec: scrim?.durationSec };
    })
    .filter((r) => r.length === DRAFT_PICKS && typeof r.sec === 'number' && r.sec > 0);
  for (let a = 0; a < read.length; a++) {
    for (let b = a + 1; b < read.length; b++) {
      const x = read[a];
      const y = read[b];
      if (x.ten !== y.ten || Math.abs(x.sec! - y.sec!) > SAME_LENGTH_SEC) continue;
      add([...x.group, ...y.group], (label) => `${label} look like one game: the same ten champions, ${clock(x.sec!)} long.`);
    }
  }
  return out;
}

/** Local calendar days from one moment to another. */
function daysBetween(from: number, to: number): number {
  const day = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  return day(to) - day(from);
}

/**
 * Replay files dated well before the day the series was scheduled, when both are known.
 *
 * `Scrim.playedOn` is not when the game was played: a replay carries no start time, so the importer
 * stores the file's own timestamp, which is when the .rofl was downloaded from the client's match
 * history or saved from a teammate's message. Only one direction is evidence (17 Sep 2026): a file
 * cannot be written before its game was played, so one dated days before the series is another
 * game's replay, while one dated days after is only a late download and was flagged on correct series.
 */
function dateMismatch(
  series: AuditSeries,
  games: readonly SeriesGame[],
  scrimById: ReadonlyMap<string, Pick<Scrim, 'playedOn'>>
): SeriesFinding | null {
  const scheduled = parseLocalDate(series.scheduledAt);
  if (scheduled === null) return null;
  const early = games
    .map((game) => {
      const filed = game.matchId ? Date.parse(scrimById.get(game.matchId)?.playedOn ?? '') : NaN;
      return { game, days: Number.isNaN(filed) ? 0 : daysBetween(filed, scheduled) };
    })
    .filter((f) => f.days > DATE_SLACK_DAYS);
  if (!early.length) return null;
  const low = Math.min(...early.map((f) => f.days));
  const high = Math.max(...early.map((f) => f.days));
  return {
    kind: 'dateMismatch',
    seriesId: series.id,
    gameIds: early.map((f) => f.game.id),
    text: `${opponentOf(series)} ${gamesWords(early.map((f) => f.game.gameNumber))}: ${early.length === 1 ? 'the replay file is' : 'the replay files are'} dated ${low === high ? low : `${low} to ${high}`} days before the series date. Wrong replay?`
  };
}

/** A game the room drafted in full whose linked replay is mostly other champions. */
function draftMismatches(
  series: AuditSeries,
  games: readonly SeriesGame[],
  scrimById: ReadonlyMap<string, Pick<Scrim, 'players'>>
): SeriesFinding[] {
  const out: SeriesFinding[] = [];
  for (const game of games) {
    const players = game.matchId ? scrimById.get(game.matchId)?.players : undefined;
    if (!players?.length) continue;
    const shared = draftOverlap(game.pickLog, players.map((p) => p.champion));
    if (shared === null || shared >= DRAFT_MATCH_MIN) continue;
    out.push({
      kind: 'draftMismatch',
      seriesId: series.id,
      gameIds: [game.id],
      text: `${opponentOf(series)} G${game.gameNumber}: the replay shares only ${shared} of the ${DRAFT_PICKS} champions with the draft run in the room. Wrong replay?`
    });
  }
  return out;
}

// ---- Reading it on the Plan -----------------------------------------------------------------------

const KIND_LABEL: Record<SeriesAuditKind, (n: number) => string> = {
  repeat: (n) => (n === 1 ? '1 repeat' : `${n} repeats`),
  afterDecided: () => 'Game after decided',
  overCap: () => 'Too many games',
  duplicate: (n) => (n === 1 ? 'Duplicate replay' : `${n} duplicate replays`),
  dateMismatch: () => 'Date mismatch',
  draftMismatch: (n) => (n === 1 ? 'Replay mismatch' : `${n} replay mismatches`)
};

/**
 * The series head's one chip: what is wrong in two words when it is one kind of thing, a count when it
 * is several, and every sentence in the tip. Null when the series checks out.
 */
export function auditChip(findings: readonly SeriesFinding[]): { label: string; tip: string } | null {
  if (!findings.length) return null;
  const kinds = [...new Set(findings.map((f) => f.kind))];
  const label = kinds.length === 1 ? KIND_LABEL[kinds[0]](findings.length) : `${findings.length} to check`;
  return { label, tip: findings.map((f) => f.text).join('\n') };
}

/**
 * The tip on a burned chip whose champion a repeat is about: where else it went, since the burned list
 * shows it once. Empty when the champion is not repeated.
 */
export function burnedTip(
  findings: readonly SeriesFinding[],
  games: readonly Pick<SeriesGame, 'id' | 'gameNumber' | 'matchId'>[],
  champion: string,
  championName: (champion: string) => string = (c) => c
): string {
  const key = canonicalChampion(champion);
  const repeat = findings.find((f) => f.kind === 'repeat' && !!f.champion && canonicalChampion(f.champion) === key);
  if (!repeat) return '';
  const involved = repeat.gameIds.map((id) => games.find((g) => g.id === id)).filter((g): g is NonNullable<typeof g> => !!g).sort(byGameNumber);
  if (!involved.length) return '';
  const name = championName(champion);
  const wrong = involved.some((g) => !!g.matchId) ? ' Wrong replay?' : '';
  if (involved.length === 1) return `${name} is on both sides of Game ${involved[0].gameNumber}.${wrong}`;
  return `${name} is also in ${andList(involved.slice(1).map((g) => `Game ${g.gameNumber}`))}.${wrong}`;
}

// ---- Before an import ---------------------------------------------------------------------------

export type ImportConflictKind = 'replaces' | 'draftMismatch' | 'burned' | 'decided';

export interface ImportConflict {
  kind: ImportConflictKind;
  /** The burned champions, as the replay spells them. */
  champions?: string[];
  /** The sentence the dialog reads. */
  text: string;
  /** The same thing as a clause, for the line left when the answer is no. */
  short: string;
}

const hasPicks = (game: Pick<SeriesGame, 'ourChampions' | 'theirChampions'>) =>
  (game.ourChampions ?? []).some(Boolean) || (game.theirChampions ?? []).some(Boolean);

/**
 * Which game of a series a replay lands on (17 Sep 2026). A game already carrying this replay first —
 * two games holding one replay is the duplicate the audit names — then the game whose ten-pick log shares
 * the most champions with the file, at least eight, then the first game with nothing in it. Before the
 * log was read, a drafted game was never an open slot, so its replay made a game 4 of a Bo3.
 *
 * The best match and not the first: a scrim block drafts in the room without fearless, so two logs can
 * both clear eight, and the first one took the other game's replay and result. Ties go to the lower game.
 *
 * A drafted game already holding another replay is still its draft's game when the file fits that draft
 * better than the board the other replay filled: MAD Synergy's game 1 carried the wrong file, and skipping
 * it made the right one a silent game 2. `importConflicts` then asks before the link is replaced.
 */
export function importTarget(games: readonly SeriesGame[], matchId: string, replayChampions: readonly string[]): SeriesGame | undefined {
  const ordered = [...games].sort(byGameNumber);
  const existing = ordered.find((g) => g.matchId === matchId);
  if (existing) return existing;
  let drafted: { game: SeriesGame; shared: number } | undefined;
  for (const game of ordered) {
    const shared = draftOverlap(game.pickLog, replayChampions) ?? 0;
    if (shared < DRAFT_MATCH_MIN) continue;
    // A replay that already fits this draft as well as the file does is that game's own.
    if (game.matchId && shared <= (draftOverlap(game.pickLog, [...(game.ourChampions ?? []), ...(game.theirChampions ?? [])]) ?? 0)) continue;
    if (!drafted || shared > drafted.shared) drafted = { game, shared };
  }
  return drafted?.game ?? ordered.find((g) => !g.matchId && g.win === undefined && !hasPicks(g));
}

/**
 * What linking this replay to this game would break: another replay the game already carries, a draft
 * the room ran that the file does not match, a champion an earlier game of a fearless series already
 * burned, or a series already decided before this game. Nothing else for a sandbox series. `target` is
 * the game it lands on, or the number a new game would take; `matchId` is the replay's own id.
 */
export function importConflicts(i: {
  series: Pick<TournamentSeries, 'id' | 'tournamentId' | 'bestOf' | 'sandbox'>;
  tournaments: readonly Pick<Tournament, 'id' | 'kind' | 'fearless'>[];
  games: readonly SeriesGame[];
  target: Pick<SeriesGame, 'gameNumber'> & Partial<Pick<SeriesGame, 'id' | 'pickLog' | 'matchId'>>;
  replayChampions: readonly string[];
  matchId?: string;
  championName?: (champion: string) => string;
}): ImportConflict[] {
  const n = i.target.gameNumber;
  const shared = draftOverlap(i.target.pickLog, i.replayChampions);
  const out: ImportConflict[] = [];

  // Asked even in a sandbox (17 Sep 2026): replacing a link is a write the person has to see, not a
  // judgement about the series.
  if (i.matchId && i.target.matchId && i.target.matchId !== i.matchId) {
    const held = i.target.matchId;
    out.push({
      kind: 'replaces',
      text:
        shared !== null && shared >= DRAFT_MATCH_MIN
          ? `Game ${n}'s draft matches this replay, but the game already carries ${held}. Linking replaces it.`
          : `Game ${n} already carries ${held}. Linking replaces it.`,
      short: `game ${n} already carries ${held}`
    });
  }

  if (i.series.sandbox === true) return out;
  const name = (champion: string) => i.championName?.(champion) ?? champion;
  const earlier = i.games
    .filter((g) => g.seriesId === i.series.id && g.id !== i.target.id && g.gameNumber < n)
    .sort(byGameNumber);

  if (shared !== null && shared < DRAFT_MATCH_MIN) {
    const differ = Math.max(0, DRAFT_PICKS - shared);
    out.push({
      kind: 'draftMismatch',
      text: `${differ} of the ${DRAFT_PICKS} champions differ from the draft you ran.`,
      short: `it does not match game ${n}'s draft`
    });
  }

  if (isFearlessSeries(i.series, i.tournaments)) {
    const burnedIn = new Map<string, number>();
    for (const game of earlier) {
      for (const champion of champions([...(game.ourChampions ?? []), ...(game.theirChampions ?? [])])) {
        const key = canonicalChampion(champion);
        if (key && !burnedIn.has(key)) burnedIn.set(key, game.gameNumber);
      }
    }
    const byGame = new Map<number, string[]>();
    const seen = new Set<string>();
    for (const champion of champions(i.replayChampions)) {
      const key = canonicalChampion(champion);
      const game = burnedIn.get(key);
      if (game === undefined || seen.has(key)) continue;
      seen.add(key);
      byGame.set(game, [...(byGame.get(game) ?? []), champion]);
    }
    if (byGame.size) {
      const all = [...byGame.values()].flat();
      const text = [...byGame.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([game, list]) => `${andList(list.map(name))} ${list.length === 1 ? 'was' : 'were'} already burned in game ${game}.`)
        .join(' ');
      out.push({
        kind: 'burned',
        champions: all,
        text,
        short: `${andList(all.map(name))} ${all.length === 1 ? 'was' : 'were'} already burned`
      });
    }
  }

  if (i.series.bestOf > 0) {
    const score = seriesScoreOf(earlier);
    if (isDecided(i.series.bestOf, score)) {
      out.push({
        kind: 'decided',
        text: `The Bo${i.series.bestOf} was already decided at ${score.wins}–${score.losses} before game ${n}.`,
        short: `the Bo${i.series.bestOf} was already decided`
      });
    }
  }
  return out;
}

/**
 * The one dialog naming every conflict. The button says what it does: replace the replay a game
 * carries, or link it regardless.
 */
export function importConfirm(conflicts: readonly ImportConflict[], gameNumber: number): { title: string; body: string; confirmLabel: string } {
  const kinds = new Set(conflicts.map((c) => c.kind));
  const burned = conflicts.find((c) => c.kind === 'burned')?.champions?.length ?? 0;
  const title = kinds.has('replaces')
    ? `Replace the replay on game ${gameNumber}?`
    : kinds.has('draftMismatch')
      ? `This replay doesn't match game ${gameNumber}'s draft`
      : kinds.has('burned')
        ? `This replay repeats ${burned === 1 ? 'a burned champion' : 'burned champions'}`
        : `This series was already decided before game ${gameNumber}`;
  const confirmLabel = kinds.has('replaces') ? 'Replace the replay' : 'Link it anyway';
  return { title, body: conflicts.map((c) => c.text).join(' '), confirmLabel };
}

/** Why nothing was written, after a no: "it does not match game 1's draft; Pantheon was already burned". */
export function importRefusal(conflicts: readonly ImportConflict[]): string {
  return conflicts.map((c) => c.short).join('; ');
}
