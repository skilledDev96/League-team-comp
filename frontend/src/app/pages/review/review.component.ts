import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalysisGame } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { CompAnalysisService } from '../../services/comp-analysis.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { effectiveComp } from '../../core/comp-alias';
import {
  commonestFactor,
  formatDuration,
  LossGroup,
  OFF_BOOK,
  FACTOR_GUIDE,
  factorsOf,
  Outcome,
  reviewReadout,
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
 * It reads the same cached `compAnalysis` payload, so opening it costs nothing
 * against the rate limit. Refreshing is offered here as well as on Analysis —
 * the page kept telling people to go elsewhere for it — but both go through the
 * one service, so a run started on either shows as running on both.
 */
@Component({
  selector: 'app-review',
  imports: [DatePipe, RouterLink, TooltipDirective],
  templateUrl: './review.component.html'
})
export class ReviewComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  private readonly analysisService = inject(CompAnalysisService);
  protected readonly formatDuration = formatDuration;
  protected readonly factorsOf = factorsOf;

  /** Shared with the Analysis page, so a run started on either shows on both. */
  protected readonly refreshing = this.analysisService.running;
  protected readonly refreshError = signal('');

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

  /**
   * The bars stated as a conclusion, reading both sides at once.
   *
   * Not tied to the toggle on purpose: the useful sentence compares wins
   * against losses, and having to flip tabs to assemble it is the work this is
   * meant to remove.
   */
  protected readonly readout = computed(() => reviewReadout(this.filteredGames()));

  protected readonly hasReadout = computed(() => {
    const r = this.readout();
    return !!(r.winning || r.losing || r.gap);
  });

  /** One line per factor, shown on hover rather than taking up layout. */
  protected factorHint(code: string): string {
    return FACTOR_GUIDE[code] ?? '';
  }

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

  /**
   * Refresh from here rather than sending people to Analysis for it.
   *
   * The flag lives on the service, so a run started on either page shows as
   * running on both, and returning mid-run still says so. Edit-gated to match
   * the Analysis button — a refresh writes `meta/compAnalysis` and spends Riot
   * budget, so it is not a viewer's to trigger.
   */
  protected async refresh(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshError.set('');
    try {
      await this.analysisService.refresh(
        this.data.players(),
        this.data.comps(),
        this.data.compOverrideMap()
      );
    } catch (err) {
      this.refreshError.set(err instanceof Error ? err.message : 'Analysis failed.');
    }
  }

  /**
   * What to say about a game no factor claimed.
   *
   * It used to assert the game "was won in the fights", which was a guess
   * dressed as a finding — and now a checkable one: if the fights had been won
   * decisively, `won_fights` would have fired. With the tally in hand the
   * honest answer is the scoreline itself.
   */
  protected noFactorLine(game: AnalysisGame): string {
    const kills = game.kills;
    if (!kills) {
      return game.win
        ? 'No standout factor — the objectives stayed close.'
        : 'No standout factor — the objectives stayed close.';
    }
    return `Nothing decided it on the map, and the fights were traded — kills ${kills.ours}-${kills.theirs}.`;
  }

  /** Our five, in role order, for the icon strip on each card. */
  protected ourChampions(game: AnalysisGame): string[] {
    return game.players.map((p) => p.champion).filter(Boolean);
  }

  /**
   * The draft lane by lane: our pick against theirs, per role.
   *
   * Rows are driven by our side, which the backend sorts by role. The enemy is
   * matched by role rather than by list position — pairing two arrays by index
   * would silently mislabel a matchup whenever Riot returns them in a different
   * order, and a wrong lane matchup is worse than none.
   *
   * Empty when the analysis predates `enemies`, so the caller can fall back.
   */
  protected draftRows(
    game: AnalysisGame
  ): { position: string; champion: string; player: string; theirs: string | null }[] {
    if (!game.enemies?.length) return [];
    const theirs = new Map(game.enemies.map((e) => [e.position, e.champion]));
    return game.players.map((p) => ({
      position: p.position,
      champion: p.champion,
      // Our side names the player; the enemy side cannot. Resolving their
      // puuids would be a Riot call per player per game, and the icon already
      // says who they were.
      player: p.name,
      theirs: theirs.get(p.position) ?? null
    }));
  }

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
