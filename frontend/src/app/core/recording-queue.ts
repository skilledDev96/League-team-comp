/**
 * Which customs can still be recorded (17 Sep 2026).
 *
 * A replay plays only in the client of the patch it was saved on, and the recorder
 * (`npm run record -- <matchId>`) needs the client to play it. Of the first twenty-one customs
 * imported, one was recorded; eighteen were saved on 16.17 and can never be recorded now, and
 * nothing in the app said so while they still could. So every scrim carries the build its file was
 * saved on (`Scrim.gameVersion`), and this sorts them for Admin › Diagnostics: the ones on the
 * newest patch not yet recorded, the ones recorded, the ones past their patch, and the ones whose
 * build nobody has read.
 *
 * Pure: the scrims, the games and the recorded ids come in, and so does today, so the spec pins it.
 */
import { Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { parseLocalDate } from './local-date';
import { patchOfBuild } from './replay-parse';

/**
 * Patches land two weeks apart, but the first game on a patch comes on or after the day it landed, so two weeks
 * from that game can only be on time or late, the unsafe side of a deadline. The estimate takes the day before
 * (17 Sep 2026): exact when the first game came the day after the patch, as 26.18's did, a day early on patch day.
 */
export const PATCH_ESTIMATE_DAYS = 13;

/**
 * How far after the first game on the current patch a date in Settings may be and still be that patch's close:
 * two weeks and a week's slack for a long patch. A later one belongs to a patch no imported replay is on yet,
 * set once the client had already moved on, so it must not reopen this patch's games (17 Sep 2026).
 */
export const SET_DATE_MAX_DAYS = 21;

export interface RecordingRow {
  matchId: string;
  /** The series' opponent, else the name the replay was filed under; empty when neither says. */
  opponent: string;
  /** "Game 2" when the replay is a game of a series, else empty. */
  game: string;
  durationSec: number;
  /** ISO, as the scrim keeps it. */
  playedOn: string;
  /** "26.18", or empty when the build is unknown. */
  patch: string;
  /** A game of a real tournament rather than a scrim block: these are listed first. */
  tournament: boolean;
}

export interface RecordingQueue {
  /** The newest patch any scrim was saved on; empty when no scrim carries a build. */
  currentPatch: string;
  /** YYYY-MM-DD the current patch's replays stop playing; empty when there is no current patch. */
  closesOn: string;
  /** True when `closesOn` is the estimate rather than the date set in Settings. */
  estimated: boolean;
  /** True once today has reached `closesOn`: the current patch's replays have joined the closed ones. */
  lapsed: boolean;
  /** On the current patch, not recorded, and the patch has not moved on. */
  recordable: RecordingRow[];
  recorded: RecordingRow[];
  /** On an older patch (or the current one once it has lapsed), and never recorded. */
  closed: RecordingRow[];
  /** No build read yet: imported before 17 Sep 2026 and not backfilled. */
  unknown: RecordingRow[];
}

export interface RecordingQueueInput {
  scrims: readonly Scrim[];
  seriesGames: readonly SeriesGame[];
  series: readonly TournamentSeries[];
  tournaments: readonly Tournament[];
  /** The ids of the `replayRecordings` documents. */
  recordedIds: Iterable<string>;
  /** `Settings.nextPatchOn`, YYYY-MM-DD. */
  nextPatchOn?: string;
  /** YYYY-MM-DD, local. */
  today: string;
}

/** A local day as YYYY-MM-DD, from epoch ms. */
export function localDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A YYYY-MM-DD day moved by whole days, through the calendar so month ends and clock changes do not slip it. */
function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDayOf(new Date(y, m - 1, d + days).getTime());
}

/** Patches compared as numbers, so 26.9 comes before 26.18. */
function patchOrder(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number);
  const [bMajor, bMinor] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor;
}

/** The command that records a game, as the card copies it. */
export function recordCommand(matchId: string): string {
  return `npm run record -- ${matchId}`;
}

export function recordingQueue(input: RecordingQueueInput): RecordingQueue {
  const recorded = new Set(input.recordedIds);
  const seriesById = new Map(input.series.map((s) => [s.id, s]));
  const tournamentById = new Map(input.tournaments.map((t) => [t.id, t]));

  const rows = input.scrims.map((scrim): RecordingRow => {
    const game = input.seriesGames.find((g) => g.matchId === scrim.id);
    const series = game ? seriesById.get(game.seriesId) : undefined;
    const group = series ? tournamentById.get(series.tournamentId) : undefined;
    return {
      matchId: scrim.id,
      opponent: series?.opponent?.trim() || scrim.opponent?.trim() || '',
      game: game ? `Game ${game.gameNumber}` : '',
      durationSec: scrim.durationSec,
      playedOn: scrim.playedOn,
      patch: patchOfBuild(scrim.gameVersion),
      // A group without a kind is a tournament (the model's default); the scrims group is not.
      tournament: !!group && group.kind !== 'scrims'
    };
  });

  const currentPatch = rows.reduce((newest, r) => (r.patch && (!newest || patchOrder(r.patch, newest) > 0) ? r.patch : newest), '');

  // The first day a game was played on the current patch, which the patch had landed by.
  const firstDay = rows
    .filter((r) => r.patch && r.patch === currentPatch)
    .map((r) => parseLocalDate(r.playedOn))
    .filter((ms): ms is number => ms !== null)
    .map(localDayOf)
    .sort()[0];

  let closesOn = '';
  let estimated = false;
  if (currentPatch) {
    // The date in Settings counts only when it can be this patch's close. One on or before this patch's first
    // game is the last patch's, left in Settings; one more than three weeks after it is a later patch's, typed
    // once the client had moved on before a replay from the new patch was imported (17 Sep 2026).
    const set = input.nextPatchOn?.trim();
    if (set && /^\d{4}-\d{2}-\d{2}$/.test(set) && (!firstDay || (set > firstDay && set <= addDays(firstDay, SET_DATE_MAX_DAYS)))) {
      closesOn = set;
    } else if (firstDay) {
      closesOn = addDays(firstDay, PATCH_ESTIMATE_DAYS);
      estimated = true;
    }
  }
  const lapsed = !!closesOn && input.today >= closesOn;

  const queue: RecordingQueue = { currentPatch, closesOn, estimated, lapsed, recordable: [], recorded: [], closed: [], unknown: [] };
  for (const row of rows) {
    if (recorded.has(row.matchId)) queue.recorded.push(row);
    else if (!row.patch) queue.unknown.push(row);
    else if (row.patch === currentPatch && !lapsed) queue.recordable.push(row);
    else queue.closed.push(row);
  }

  // Tournament games first, since a scrim matters less if only one can be recorded in time; then newest.
  const order = (a: RecordingRow, b: RecordingRow) =>
    Number(b.tournament) - Number(a.tournament) || (parseLocalDate(b.playedOn) ?? 0) - (parseLocalDate(a.playedOn) ?? 0);
  queue.recordable.sort(order);
  queue.recorded.sort(order);
  queue.closed.sort(order);
  queue.unknown.sort(order);
  return queue;
}
