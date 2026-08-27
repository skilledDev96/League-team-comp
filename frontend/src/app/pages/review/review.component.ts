import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalysisGame } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { formatDuration, summariseLosses } from './loss-patterns.util';

/**
 * The losses, and what they have in common.
 *
 * Deliberately a separate page from Analysis rather than another panel on it.
 * Analysis answers "which comps win" and is already dense; this answers "what
 * keeps going wrong", which is a different question asked at a different time —
 * usually the evening after a series, not during drafting.
 *
 * It reads the same cached `compAnalysis` payload and never calls Riot itself,
 * so opening it costs nothing against the rate limit. Refresh still lives on
 * the Analysis page, and this page points there rather than duplicating it.
 */
@Component({
  selector: 'app-review',
  imports: [DatePipe, RouterLink],
  templateUrl: './review.component.html'
})
export class ReviewComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly formatDuration = formatDuration;

  protected readonly compFilter = signal<string>('all');
  /** Match id of the game whose objective detail is open, or null for none. */
  protected readonly expandedId = signal<string | null>(null);

  protected readonly analysis = computed(() => this.data.compAnalysis());

  private readonly filteredGames = computed<AnalysisGame[]>(() => {
    const comp = this.compFilter();
    const games = this.analysis()?.games ?? [];
    return comp === 'all' ? games : games.filter((game) => game.compId === comp);
  });

  protected readonly summary = computed(() => summariseLosses(this.filteredGames()));

  protected readonly losses = computed(() =>
    this.filteredGames()
      .filter((game) => !game.win)
      .sort((a, b) => b.date - a.date)
  );

  /** Comps that actually appear in the analysed games, so the filter has no dead options. */
  protected readonly compOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const game of this.analysis()?.games ?? []) {
      if (game.compId) seen.set(game.compId, game.compName ?? 'Comp');
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly record = computed(() => {
    const games = this.filteredGames();
    const wins = games.filter((game) => game.win).length;
    return { games: games.length, wins, losses: games.length - wins };
  });

  protected toggle(matchId: string): void {
    this.expandedId.update((open) => (open === matchId ? null : matchId));
  }

  /** Both sides of one objective, for the expanded detail rows. */
  protected objectiveRows(game: AnalysisGame): { label: string; ours: number; theirs: number }[] {
    const o = game.objectives;
    if (!o) return [];
    return [
      { label: 'Dragons', ours: o.ours.dragons, theirs: o.theirs.dragons },
      { label: 'Barons', ours: o.ours.barons, theirs: o.theirs.barons },
      { label: 'Heralds', ours: o.ours.heralds, theirs: o.theirs.heralds },
      { label: 'Voidgrubs', ours: o.ours.grubs, theirs: o.theirs.grubs },
      { label: 'Towers', ours: o.ours.towers, theirs: o.theirs.towers },
      { label: 'Inhibitors', ours: o.ours.inhibitors, theirs: o.theirs.inhibitors }
    ];
  }
}
