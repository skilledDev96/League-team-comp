import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalysisGame } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { effectiveComp } from '../../core/comp-alias';
import {
  commonestFactor,
  formatDuration,
  LossGroup,
  OFF_BOOK,
  factorsOf,
  Outcome,
  summarise
} from './loss-patterns.util';

/**
 * The games, and what they have in common — losses by default, wins on the
 * other side of the toggle.
 *
 * Deliberately a separate page from Analysis rather than another panel on it.
 * Analysis answers "which comps win" and is already dense; this answers "what
 * keeps happening", which is a different question asked at a different time —
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
  protected readonly factorsOf = factorsOf;

  protected readonly offBook = OFF_BOOK;

  protected readonly compFilter = signal<string>('all');
  /** Match id of the game whose objective detail is open, or null for none. */
  protected readonly expandedId = signal<string | null>(null);

  protected readonly analysis = computed(() => this.data.compAnalysis());

  /**
   * The comp a game counts as, including corrections made since the last
   * refresh. Reading `game.compId` alone would show a game under its old comp
   * until someone refreshed, disagreeing with the Analysis page in the meantime.
   */
  private compFor(game: AnalysisGame): { id: string; name: string } | null {
    return effectiveComp(game.compId, this.data.compOverride(game.matchId), this.data.comps());
  }

  private readonly filteredGames = computed<AnalysisGame[]>(() => {
    const comp = this.compFilter();
    const games = this.analysis()?.games ?? [];
    return comp === 'all' ? games : games.filter((game) => this.compFor(game)?.id === comp);
  });

  /**
   * Which side of the result the page is showing.
   *
   * A toggle rather than two stacked sections: the losses alone already ran to
   * a hundred cards before they were grouped, and showing both at once would
   * undo that. Losses lead because that is the question people open this page
   * with; the wins are there to answer "what were we doing when it worked".
   */
  protected readonly outcome = signal<Outcome>('loss');

  protected readonly summary = computed(() => summarise(this.filteredGames(), this.outcome()));

  private readonly allLosses = computed(() =>
    this.filteredGames()
      .filter((game) => game.win === (this.outcome() === 'win'))
      .sort((a, b) => b.date - a.date)
  );

  /**
   * Losses that can actually be reviewed. The rest are counted, never listed: a
   * row reading "objective data not cached" says nothing a reader can act on,
   * and eighty of them bury the ones that can.
   */
  protected readonly losses = computed(() => this.allLosses().filter((game) => game.objectives));

  protected readonly pendingLosses = computed(() =>
    this.allLosses().filter((game) => !game.objectives)
  );

  /**
   * Losses grouped under the comp that was played.
   *
   * A flat list by date answers "what happened last Tuesday", which nobody
   * asks. Grouped, the page answers the question it exists for — whether a comp
   * keeps losing the same way — and collapses to a screen of comp names rather
   * than a hundred cards.
   */
  protected readonly lossGroups = computed<LossGroup[]>(() => {
    const groups = new Map<string, LossGroup>();
    for (const game of this.allLosses()) {
      const comp = this.compFor(game);
      const id = comp?.id ?? OFF_BOOK;
      let group = groups.get(id);
      if (!group) {
        group = {
          compId: id,
          name: comp?.name ?? 'Off-book comps',
          losses: [],
          pending: 0,
          topFactor: null
        };
        groups.set(id, group);
      }
      if (game.objectives) group.losses.push(game);
      else group.pending += 1;
    }

    for (const group of groups.values()) {
      group.topFactor = commonestFactor(group.losses);
    }

    // Most losses first — the comp costing the most games is the one to read.
    // Off-book games are a bucket rather than a comp, so they sink to the end
    // however many there are.
    return [...groups.values()].sort((a, b) => {
      if ((a.compId === OFF_BOOK) !== (b.compId === OFF_BOOK)) return a.compId === OFF_BOOK ? 1 : -1;
      return (
        b.losses.length - a.losses.length || b.pending - a.pending || a.name.localeCompare(b.name)
      );
    });
  });

  /** Comps that actually appear in the analysed games, so the filter has no dead options. */
  protected readonly compOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const game of this.analysis()?.games ?? []) {
      const comp = this.compFor(game);
      if (comp) seen.set(comp.id, comp.name);
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
