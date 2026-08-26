import { computed, inject, Injectable, signal } from '@angular/core';
import { SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { blockedSet, CompAvailability, compAvailability, PoolPressure, poolPressure } from './draft.util';

/**
 * What the Plan and Draft views both need: which tournament is open, its
 * series and games, and the fearless maths derived from them.
 *
 * Planning and drafting are different jobs and live in different components,
 * but they read the same series — so the shared derivations sit here rather
 * than being computed twice or passed down through inputs.
 */
@Injectable({ providedIn: 'root' })
export class TournamentContextService {
  private readonly data = inject(TeamDataService);
  private readonly ui = inject(UiService);

  readonly roles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;

  /** Our team name, used to label the sides of a game. */
  readonly teamName = computed(() => this.data.settings().teamName || 'Us');

  // ---- Selection ---------------------------------------------------------

  private readonly chosenTournamentId = signal<string>('');
  readonly openSeriesId = signal<string>('');

  readonly tournaments = computed(() => this.data.tournaments());

  /** Defaults to the active tournament so the page opens on what matters now. */
  readonly currentTournament = computed<Tournament | null>(() => {
    const all = this.tournaments();
    const chosen = this.chosenTournamentId();
    if (chosen) return all.find((t) => t.id === chosen) ?? null;
    return all.find((t) => t.active) ?? all[0] ?? null;
  });

  selectTournament(id: string): void {
    this.chosenTournamentId.set(id);
    this.openSeriesId.set('');
  }

  readonly seriesList = computed<TournamentSeries[]>(() => {
    const t = this.currentTournament();
    if (!t) return [];
    return this.data.tournamentSeries().filter((s) => s.tournamentId === t.id);
  });

  gamesFor(seriesId: string): SeriesGame[] {
    return this.data
      .seriesGames()
      .filter((g) => g.seriesId === seriesId)
      .sort((a, b) => a.gameNumber - b.gameNumber);
  }

  seriesScore(seriesId: string): { wins: number; losses: number } {
    const games = this.gamesFor(seriesId).filter((g) => g.win !== undefined);
    const wins = games.filter((g) => g.win).length;
    return { wins, losses: games.length - wins };
  }

  // ---- Fearless draft ----------------------------------------------------

  /**
   * Every champion burned in this series so far. Under Fearless Draft a champion
   * used by *either* team is gone for the rest of the series, so both sides count.
   */
  usedChampions(seriesId: string): string[] {
    const used: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      used.push(...(game.ourChampions ?? []), ...(game.theirChampions ?? []));
    }
    return [...new Set(used.filter(Boolean))];
  }

  usedCount(seriesId: string): number {
    return this.usedChampions(seriesId).length;
  }

  /** Champions burned by games *before* this one — the fearless carry-over. */
  burnedBefore(seriesId: string, gameNumber: number): string[] {
    const used: string[] = [];
    for (const game of this.gamesFor(seriesId)) {
      if (game.gameNumber >= gameNumber) continue;
      used.push(...(game.ourChampions ?? []), ...(game.theirChampions ?? []));
    }
    return [...new Set(used.filter(Boolean))];
  }

  /** Our comps reduced to their five champions, for the availability maths. */
  compChampions() {
    const ranked = this.data.compAnalysis()?.comps ?? [];
    return this.data.comps().map((comp) => {
      const record = ranked.find((r) => r.compId === comp.id);
      return {
        id: comp.id,
        name: comp.name,
        category: comp.category,
        winRate: record?.winRate,
        games: record?.games,
        champions: this.roles.map((role) => this.ui.parseCompLine(comp.picks[role] ?? '').champion)
      };
    });
  }

  /** Which of our defined comps survive into the next game of this series. */
  compAvailability(seriesId: string): CompAvailability[] {
    return compAvailability(this.compChampions(), blockedSet(this.usedChampions(seriesId)));
  }

  playableComps(seriesId: string): CompAvailability[] {
    return this.compAvailability(seriesId).filter((c) => c.playable);
  }

  /** Broken comps, least-damaged first — those are the easiest to patch. */
  brokenComps(seriesId: string): CompAvailability[] {
    return this.compAvailability(seriesId).filter((c) => !c.playable);
  }

  /** Roster champion pools thinning out as the series burns champions. */
  poolPressure(seriesId: string): PoolPressure[] {
    return poolPressure(
      this.data.players().map((p) => ({ name: p.name, pool: p.top3 ?? [] })),
      blockedSet(this.usedChampions(seriesId))
    );
  }
}
