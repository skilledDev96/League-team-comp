import { inject, Injectable, signal } from '@angular/core';
import { Scrim, SeriesGame, SeriesGameBoard, Tournament, TournamentSeries } from '../models/team.models';
import { importReport, readReplay, ReplayRead } from '../core/replay-import';
import { seatChampions } from '../core/replay-parse';
import { slugOpponent, UNNAMED_OPPONENT } from '../core/opponent-slug';
import { DRAFT_LENGTH } from '../pages/tournaments/draft-sequence';
import { rosterIds, scrimSide } from '../pages/games/game-rows';
import { TeamDataService } from './team-data.service';
import { ToastService } from './toast.service';
import { ConfirmService } from './confirm.service';

type Side = 'blue' | 'red';
type SeatPlayers = Parameters<typeof seatChampions>[0];

// ---- The rules a replay is linked by (14 Sep 2026) -------------------------------------------
//
// Pure, so the series page and this service decide the same way and the spec can hold them. The
// audit of 13 Sep 2026 found three silent overwrites: MOSS 2's replay imported onto MAD Synergy
// game 1 (already MOSS 2 game 1's) rewrote the scrim's opponent and the typed Win; MAD Synergy
// game 3 trusted a side set on the draft over the five names in the file; and unlink blanked a
// typed board and result with no question.

/** Which side our five are on by the names in the file alone, never a side stored on the record. */
export function rosterSideOf(scrim: { players: Scrim['players'] }, roster: Set<string>): Side | null {
  return scrimSide({ players: scrim.players } as Scrim, roster);
}

/**
 * The side a replay is filled as. The roster's names win when they tell; the side on the game
 * (set in the draft room) is only the fallback for a file with none of ours in it. `conflict` is
 * the case to warn about: both said something and they disagree.
 */
export function replaySide(named: Side | null, onGame: Side | undefined): { side: Side | null; conflict: boolean } {
  if (named) return { side: named, conflict: !!onGame && onGame !== named };
  return { side: onGame ?? null, conflict: false };
}

/** The fields a replay fills on a game: both fives in seat order, the side, the result and a finished draft. */
export function replayFill(players: SeatPlayers, blueWon: boolean, side: Side | null): Pick<SeriesGame, 'ourChampions' | 'theirChampions' | 'ourSide' | 'win' | 'draftStep'> {
  if (!side) return { ourChampions: [], theirChampions: [] };
  const team = side === 'blue' ? 100 : 200;
  return {
    ourChampions: seatChampions(players, team),
    theirChampions: seatChampions(players, team === 100 ? 200 : 100),
    ourSide: side,
    win: side === 'blue' ? blueWon : !blueWon,
    draftStep: DRAFT_LENGTH
  };
}

export interface ReplayClaim {
  game: SeriesGame;
  opponent: string;
  /** The sentence the page shows when it refuses. */
  line: string;
}

/**
 * Another game that already carries this replay, or null. A replay is one game: the same match
 * on two series games counted it twice on the Games page and under two opponents. `except` names
 * what linking may touch — the game itself, or a whole series when a batch picks its own slot.
 */
export function replayClaim(
  matchId: string,
  games: readonly SeriesGame[],
  allSeries: readonly TournamentSeries[],
  except: { gameId?: string; seriesId?: string }
): ReplayClaim | null {
  const game = games.find(
    (g) => g.matchId === matchId && g.id !== except.gameId && (!except.seriesId || g.seriesId !== except.seriesId)
  );
  if (!game) return null;
  const opponent = allSeries.find((s) => s.id === game.seriesId)?.opponent || 'another opponent';
  return { game, opponent, line: `${matchId} is already game ${game.gameNumber} vs ${opponent}. Unlink it there first.` };
}

/**
 * The opponent a stored replay is filed under, when that is another series than this one — null
 * when it is this one, loose (no series by that name) or not stored yet. Linking does not rewrite
 * the name of a replay filed under another series.
 */
export function filedUnderOtherSeries(
  existing: Pick<Scrim, 'opponent'> | undefined,
  series: Pick<TournamentSeries, 'id' | 'opponent'>,
  allSeries: readonly Pick<TournamentSeries, 'id' | 'opponent'>[]
): string | null {
  const filed = existing?.opponent?.trim();
  if (!filed) return null;
  const slug = slugOpponent(filed);
  if (slug === slugOpponent(series.opponent)) return null;
  return allSeries.some((s) => s.id !== series.id && slugOpponent(s.opponent) === slug) ? filed : null;
}

/** The question asked before linking a replay filed under another series. */
export function filedQuestion(matchId: string, filedUnder: string, opponent: string): string {
  return `${matchId} is filed under ${filedUnder}. Link it to this game vs ${opponent} anyway? The replay stays filed under ${filedUnder}.`;
}

/**
 * The replay's record as it is saved: the file's figures over whatever was stored, keeping the
 * note and the place in the list, the opponent a replay filed under another series already has,
 * and a side somebody set when the file could not tell one.
 */
export function scrimToSave(
  existing: Scrim | undefined,
  read: Omit<Scrim, 'ourSide' | 'note'>,
  opponent: string,
  keepOpponent: string | null,
  side: Side | null
): Scrim {
  const saved: Scrim = { ...read, opponent: keepOpponent ?? opponent };
  if (existing) saved.order = existing.order;
  if (existing?.note) saved.note = existing.note;
  const ourSide = side ?? existing?.ourSide;
  if (ourSide) saved.ourSide = ourSide;
  return saved;
}

const hasPicks = (game: Pick<SeriesGame, 'ourChampions' | 'theirChampions'>) =>
  (game.ourChampions ?? []).some(Boolean) || (game.theirChampions ?? []).some(Boolean);

/** What a game holds that a replay's fill replaces, to keep on the game as `beforeLink`. */
export function boardOf(game: SeriesGame): SeriesGameBoard {
  return {
    ourChampions: [...(game.ourChampions ?? [])],
    theirChampions: [...(game.theirChampions ?? [])],
    ...(game.ourSide ? { ourSide: game.ourSide } : {}),
    ...(game.win !== undefined ? { win: game.win } : {}),
    ...(game.draftStep !== undefined ? { draftStep: game.draftStep } : {})
  };
}

/**
 * A game with a replay linked: the fill over it, the id, and — the first time it is linked — the
 * board it held, so unlinking can put it back. A game relinked keeps its first `beforeLink`.
 */
export function linkedGame(game: SeriesGame, fill: Partial<SeriesGame>, matchId: string): SeriesGame {
  return {
    ...game,
    ...fill,
    matchId,
    ...(game.matchId ? {} : { beforeLink: boardOf(game) })
  };
}

/**
 * The game with its replay taken off. When the link kept the board it replaced, that board and
 * its result come back; a game linked before that was kept loses the replay's picks and result,
 * as unlink always did. Bans are ours and stay either way.
 */
export function unlinkedGame(game: SeriesGame): SeriesGame {
  const next: SeriesGame = { ...game };
  delete next.matchId;
  delete next.beforeLink;
  delete next.win;
  const before = game.beforeLink;
  if (!before) return { ...next, ourChampions: [], theirChampions: [] };
  next.ourChampions = [...(before.ourChampions ?? [])];
  next.theirChampions = [...(before.theirChampions ?? [])];
  if (before.win !== undefined) next.win = before.win;
  if (before.ourSide) next.ourSide = before.ourSide;
  else delete next.ourSide;
  if (before.draftStep !== undefined) next.draftStep = before.draftStep;
  else delete next.draftStep;
  return next;
}

function contentWords(board: Pick<SeriesGame, 'ourChampions' | 'theirChampions' | 'win'>): string {
  const picks = hasPicks(board);
  const result = board.win === undefined ? '' : board.win ? 'Win' : 'Loss';
  if (picks && result) return `a ${result} and its draft`;
  if (result) return `a ${result}`;
  return picks ? 'a draft' : '';
}

/** The question before unlinking, or null when the game holds nothing a click could lose. */
export function unlinkQuestion(game: SeriesGame): string | null {
  if (!game.matchId) return null;
  if (!hasPicks(game) && game.win === undefined) return null;
  const head = `Unlink replay ${game.matchId} from game ${game.gameNumber}?`;
  const back = game.beforeLink ? contentWords(game.beforeLink) : '';
  if (back) return `${head} The replay's picks and result come off, and the game goes back to ${back} as it was before the link.`;
  return `${head} Its picks and result will be cleared.`;
}

/** The question before a replay fills a game somebody already typed a draft or a result into. */
export function replaceQuestion(game: SeriesGame, fileName: string): string | null {
  if (game.matchId) return null;
  const held = contentWords(game);
  if (!held) return null;
  return `Game ${game.gameNumber} already has ${held}. Fill it from ${fileName} instead? Unlinking the replay later puts back what is there now.`;
}


/**
 * One way in for a .rofl (9 Sep 2026): against a series, each file becomes a
 * scrim record (the replay store the Games page and the analysis read) and a
 * game on that series with both sides, the side and the result. Dropped on
 * the page with only a name, the series is found or made first. A file whose
 * side nobody can tell still lands, without a side; the game row asks.
 */
@Injectable({ providedIn: 'root' })
export class ReplayImportService {
  private readonly data = inject(TeamDataService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly importing = signal(false);
  readonly note = signal('');
  readonly skipped = signal<string[]>([]);

  /** Files against a known series. Returns the report line. */
  async importAgainst(series: TournamentSeries, files: readonly File[]): Promise<string> {
    if (!files.length || this.importing()) return '';
    this.importing.set(true);
    this.skipped.set([]);
    const failed: string[] = [];
    const refused: string[] = [];
    let saved = 0;
    let report = '';
    try {
      for (const file of files) {
        this.note.set(`Reading ${file.name}…`);
        const read = readReplay(file.name, await file.arrayBuffer(), { opponent: series.opponent, lastModified: file.lastModified, order: this.data.scrims().length + saved });
        if (!read.ok) {
          failed.push(read.line);
          continue;
        }
        const refusal = await this.linkGame(series, read);
        if (refusal) {
          refused.push(refusal);
          continue;
        }
        saved += 1;
      }
    } finally {
      this.importing.set(false);
      // A refusal is said in the report itself: the series' own note is often the only line on screen.
      report = [importReport(saved, series.opponent), ...refused].join(' ');
      this.note.set(report);
      this.skipped.set([...failed, ...refused]);
    }
    return report;
  }

  /** Files with only a name: the series in this group by that name, made if needed, then the same path. */
  async importLoose(group: Tournament, files: readonly File[], opponentName: string): Promise<string> {
    const name = opponentName.trim() || UNNAMED_OPPONENT;
    const slug = slugOpponent(name);
    let series = this.data.tournamentSeries().find((s) => s.tournamentId === group.id && slugOpponent(s.opponent) === slug);
    if (!series) {
      const id = await this.data.createSeries({ tournamentId: group.id, opponent: name, bestOf: 0, status: 'scheduled' });
      series = { id, tournamentId: group.id, opponent: name, bestOf: 0, status: 'scheduled', order: 0 };
    }
    return this.importAgainst(series, files);
  }

  /** The side, said by a person, on a game whose replay could not tell. */
  async sideGame(game: SeriesGame, scrim: Scrim, side: 'blue' | 'red'): Promise<void> {
    await this.data.saveScrim({ ...scrim, ourSide: side });
    await this.data.updateSeriesGame({ ...game, ...replayFill(scrim.players, scrim.blueWon, side) });
  }

  /** Link one read file to a game of the series. Returns why it was not linked, or null when it was. */
  private async linkGame(series: TournamentSeries, read: Extract<ReplayRead, { ok: true }>): Promise<string | null> {
    const all = this.data.seriesGames();
    const allSeries = this.data.tournamentSeries();
    const claim = replayClaim(read.id, all, allSeries, { seriesId: series.id });
    if (claim) {
      this.toast.show('Replay not imported', { text: claim.line, kind: 'warn' });
      return claim.line;
    }
    const existingScrim = this.data.scrims().find((s) => s.id === read.id);
    const filedUnder = filedUnderOtherSeries(existingScrim, series, allSeries);
    if (filedUnder && !(await this.confirm.ask({ title: 'File this replay here instead?', body: filedQuestion(read.id, filedUnder, series.opponent), confirmLabel: 'File it here' }))) {
      return `${read.id} is filed under ${filedUnder} and was left there.`;
    }

    const games = all.filter((g) => g.seriesId === series.id).sort((a, b) => a.gameNumber - b.gameNumber);
    const existing = games.find((g) => g.matchId === read.id);
    // The next free slot in the block, else the number after the last game.
    const open = existing ? undefined : games.find((g) => !g.matchId && g.win === undefined && !hasPicks(g));
    const target = existing ?? open;

    const named = rosterSideOf(read.scrim, rosterIds(this.data.players()));
    const { side, conflict } = replaySide(named, target?.ourSide);
    if (conflict && target) {
      this.toast.show(`Game ${target.gameNumber} filled as ${side}`, {
        text: `The draft had us on ${target.ourSide}, but our five are on ${side} in ${read.id}. The names in the file win.`,
        kind: 'warn'
      });
    }

    await this.data.saveScrim(scrimToSave(existingScrim, read.scrim, series.opponent, filedUnder, side));
    const fill = replayFill(read.replay.players, read.replay.blueWon, side);
    if (target) {
      await this.data.updateSeriesGame(linkedGame(target, fill, read.id));
      return null;
    }
    await this.data.createSeriesGame({
      seriesId: series.id,
      gameNumber: games.length + 1,
      ...fill,
      matchId: read.id,
      beforeLink: { ourChampions: [], theirChampions: [] }
    });
    return null;
  }
}
