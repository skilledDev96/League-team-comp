import { inject, Injectable, signal } from '@angular/core';
import { Scrim, SeriesGame, Tournament, TournamentSeries } from '../models/team.models';
import { importReport, readReplay, ReplayRead } from '../core/replay-import';
import { seatChampions } from '../core/replay-parse';
import { slugOpponent, UNNAMED_OPPONENT } from '../core/opponent-slug';
import { DRAFT_LENGTH } from '../pages/tournaments/draft-sequence';
import { rosterIds, scrimSide } from '../pages/games/game-rows';
import { TeamDataService } from './team-data.service';

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

  readonly importing = signal(false);
  readonly note = signal('');
  readonly skipped = signal<string[]>([]);

  /** Files against a known series. Returns the report line. */
  async importAgainst(series: TournamentSeries, files: readonly File[]): Promise<string> {
    if (!files.length || this.importing()) return '';
    this.importing.set(true);
    this.skipped.set([]);
    const failed: string[] = [];
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
        await this.linkGame(series, read);
        saved += 1;
      }
    } finally {
      this.importing.set(false);
      report = importReport(saved, series.opponent);
      this.note.set(report);
      this.skipped.set(failed);
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
    const team = side === 'blue' ? 100 : 200;
    await this.data.saveScrim({ ...scrim, ourSide: side });
    await this.data.updateSeriesGame({
      ...game,
      ourChampions: seatChampions(scrim.players, team),
      theirChampions: seatChampions(scrim.players, team === 100 ? 200 : 100),
      ourSide: side,
      win: side === 'blue' ? scrim.blueWon : !scrim.blueWon,
      draftStep: DRAFT_LENGTH
    });
  }

  private async linkGame(series: TournamentSeries, read: Extract<ReplayRead, { ok: true }>): Promise<void> {
    const side = scrimSide(read.scrim as Scrim, rosterIds(this.data.players()));
    await this.data.saveScrim({ ...read.scrim, opponent: series.opponent, ...(side ? { ourSide: side } : {}) });
    const games = this.data.seriesGames().filter((g) => g.seriesId === series.id).sort((a, b) => a.gameNumber - b.gameNumber);
    const existing = games.find((g) => g.matchId === read.id);
    const team = side === 'blue' ? 100 : 200;
    const filled = side
      ? {
          ourChampions: seatChampions(read.replay.players, team),
          theirChampions: seatChampions(read.replay.players, team === 100 ? 200 : 100),
          ourSide: side,
          win: side === 'blue' ? read.replay.blueWon : !read.replay.blueWon,
          draftStep: DRAFT_LENGTH
        }
      : { ourChampions: [], theirChampions: [] };
    if (existing) {
      await this.data.updateSeriesGame({ ...existing, ...filled, matchId: read.id });
      return;
    }
    // The next free slot in the block, else the number after the last game.
    const open = games.find((g) => !g.matchId && g.win === undefined && !(g.ourChampions ?? []).some(Boolean) && !(g.theirChampions ?? []).some(Boolean));
    if (open) {
      await this.data.updateSeriesGame({ ...open, ...filled, matchId: read.id });
      return;
    }
    await this.data.createSeriesGame({ seriesId: series.id, gameNumber: games.length + 1, ...filled, matchId: read.id });
  }
}
