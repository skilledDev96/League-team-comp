import { ChampionFilterService } from '../../services/champion-filter.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnalysisGame, LaneRead } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { CompAnalysisService } from '../../services/comp-analysis.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { GameCheckComponent } from '../../shared/game-check.component';
import { effectiveComp } from '../../core/comp-alias';
import {
  commonestFactor,
  formatDuration,
  LossGroup,
  OFF_BOOK,
  FACTOR_ADVICE,
  FACTOR_GUIDE,
  factorsOf,
  Outcome,
  reviewReadout,
  summarise,
  MIN_FOR_A_CLAIM
} from './loss-patterns.util';
import { formatGap, formatSide, gapIsGood, keepDoing, laneTable, laneTotals, MetricSplit, PatternSource, seatFit, SideStat, sourceOf, starterCount, teamSplits, workOn } from './win-loss-splits';

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
type SectionKey = 'lanes' | 'changes' | 'recurring' | 'games';

@Component({
  selector: 'app-review',
  imports: [DatePipe, NgTemplateOutlet, RouterLink, TooltipDirective, ChampionFilterComponent, GameCheckComponent],
  templateUrl: './review.component.html'
})
export class ReviewComponent {
  /** Hosted as the Patterns tab of the Games page: no hero, no refresh button of its own. */
  readonly embedded = input(false);
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

  protected readonly filter = inject(ChampionFilterService);

  protected readonly analysis = computed(() => this.data.compAnalysis());

  /**
   * The comp a game counts as, including corrections made since the last
   * refresh. Reading `game.compId` alone would show a game under its old comp
   * until someone refreshed, disagreeing with the Analysis page in the meantime.
   */
  private compFor(game: AnalysisGame): { id: string; name: string } | null {
    return effectiveComp(game.compId, this.data.compOverride(game.matchId), this.data.comps());
  }

  /**
   * Strictly the five by default: a game with a sub in is left out of the
   * team's read (8 Sep 2026). The switch widens it to any stack, and the
   * record line says how many games that would add.
   */
  /** How many of the current starters a game needs to count: 5 is strictly the team. */
  protected readonly minStarters = signal<5 | 4 | 3>(5);
  protected readonly starterSteps: { min: 5 | 4 | 3; label: string; tip: string }[] = [
    { min: 5, label: 'All five', tip: 'Only games where every current starter was on our side' },
    { min: 4, label: '4 or more', tip: 'Four starters and a sub count too' },
    { min: 3, label: '3 or more', tip: 'Any game with three or more starters — the widest the analysis reads' }
  ];
  private readonly starterNames = computed(() => this.data.starters().map((p) => p.name));

  /** Serious games only by default; a game tagged as messing around is left out. */
  protected readonly seriousOnly = signal(true);

  /** Comp and champion filters applied, every game, tagged or not. */
  private readonly taggedOrNot = computed<AnalysisGame[]>(() => {
    const comp = this.compFilter();
    const games = this.analysis()?.games ?? [];
    return (comp === 'all' ? games : games.filter((game) => this.compFor(game)?.id === comp)).filter((game) =>
      this.filter.passes(game.players.map((p) => p.champion))
    );
  });

  /** Serious-only applied; both sources still in, for the source badges. */
  private readonly seriousGames = computed<AnalysisGame[]>(() => {
    if (!this.seriousOnly()) return this.taggedOrNot();
    const practice = this.data.practiceSet();
    return this.taggedOrNot().filter((g) => !practice.has(g.matchId));
  });

  /**
   * Riot games and replays are read apart (8 Sep 2026): a replay has totals
   * only, so its lanes cannot be called and its per-minute figures do not
   * exist. Flex and Clash first, because that is where the lane reads are.
   */
  protected readonly source = signal<PatternSource>('riot');
  protected readonly sourceSteps: { source: PatternSource; label: string; tip: string }[] = [
    { source: 'riot', label: 'Flex & Clash', tip: 'Games Riot handed us: per-minute figures, lane reads, the lot' },
    { source: 'replay', label: 'Scrims & tournaments', tip: 'Games from replay files: end-of-game totals, objectives, no lane reads' }
  ];
  protected gamesAtSource(source: PatternSource): number {
    return this.seriousGames().filter((g) => sourceOf(g) === source).length;
  }

  private readonly anyStackGames = computed<AnalysisGame[]>(() => {
    const source = this.source();
    return this.seriousGames().filter((g) => sourceOf(g) === source);
  });

  /** Tournament games the replay view cannot count, because nobody imported the replay. */
  protected readonly missingReplays = computed(() => {
    const series = new Map(this.data.tournamentSeries().map((s) => [s.id, s]));
    return this.data
      .seriesGames()
      .filter((g) => g.win !== undefined && !g.matchId)
      .map((g) => ({ id: g.id, label: `${series.get(g.seriesId)?.opponent ?? 'series'} game ${g.gameNumber}` }));
  });

  // ---- The long sections behind chips, remembered per browser ----

  private static readonly SECTIONS_KEY = 'bom-patterns-sections';
  protected readonly sectionSteps: { key: SectionKey; label: string }[] = [
    { key: 'lanes', label: 'Lanes' },
    { key: 'changes', label: 'What changes when we win' },
    { key: 'recurring', label: 'Recurring problems' },
    { key: 'games', label: 'Game by game' }
  ];
  protected readonly sections = signal<Record<SectionKey, boolean>>(this.storedSections());

  private storedSections(): Record<SectionKey, boolean> {
    const closed: Record<SectionKey, boolean> = { lanes: false, changes: false, recurring: false, games: false };
    try {
      const raw = localStorage.getItem(ReviewComponent.SECTIONS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Record<SectionKey, boolean>>) : null;
      return parsed && typeof parsed === 'object' ? { ...closed, ...parsed } : closed;
    } catch {
      return closed;
    }
  }

  protected toggleSection(key: SectionKey): void {
    this.sections.update((s) => ({ ...s, [key]: !s[key] }));
    try {
      localStorage.setItem(ReviewComponent.SECTIONS_KEY, JSON.stringify(this.sections()));
    } catch {
      // The choice lasts for the page instead.
    }
  }

  /** Games tagged as practice in the current comp and champion selection. */
  protected readonly practiceCount = computed(() => {
    const practice = this.data.practiceSet();
    return this.taggedOrNot().filter((g) => practice.has(g.matchId)).length;
  });

  /** Games with enough starters, before the seat question. */
  private readonly starterGames = computed<AnalysisGame[]>(() => {
    const starters = this.starterNames();
    if (starters.length < 5) return this.anyStackGames();
    const min = this.minStarters();
    return this.anyStackGames().filter((g) => starterCount(g, starters) >= min);
  });

  /** Any seat, everyone in their own seat, or at least one of ours off their seat (autofill). */
  protected readonly seatMode = signal<'any' | 'on' | 'off'>('any');
  protected readonly seatSteps: { mode: 'any' | 'on' | 'off'; label: string; tip: string }[] = [
    { mode: 'any', label: 'Any seat', tip: 'Every game, whoever sat where' },
    { mode: 'on', label: 'On role', tip: 'Only games where everyone of ours sat in their own seat' },
    { mode: 'off', label: 'Off-seat', tip: 'Only games where at least one of ours was autofilled into another seat' }
  ];
  private readonly rosterSeats = computed(() => this.data.players().map((p) => ({ name: p.name, role: p.role })));

  protected readonly filteredGames = computed<AnalysisGame[]>(() => {
    const mode = this.seatMode();
    if (mode === 'any') return this.starterGames();
    const roster = this.rosterSeats();
    return this.starterGames().filter((g) => seatFit(g, roster) === mode);
  });

  protected gamesAtSeat(mode: 'any' | 'on' | 'off'): number {
    if (mode === 'any') return this.starterGames().length;
    const roster = this.rosterSeats();
    return this.starterGames().filter((g) => seatFit(g, roster) === mode).length;
  }

  /** How many games each step would count, for the buttons. */
  protected gamesAtStep(min: number): number {
    const starters = this.starterNames();
    if (starters.length < 5) return this.anyStackGames().length;
    return this.anyStackGames().filter((g) => starterCount(g, starters) >= min).length;
  }

  /** Games left out by the current step. */
  protected readonly leftOut = computed(() => this.anyStackGames().length - this.filteredGames().length);

  /**
   * Which side of the result the page is showing.
   *
   * A toggle rather than two stacked sections: the losses alone already ran to
   * a hundred cards before they were grouped, and showing both at once would
   * undo that. Losses lead because that is the question people open this page
   * with; the wins are there to answer "what were we doing when it worked".
   */
  protected readonly outcome = signal<Outcome>('loss');

  protected readonly summaryLoss = computed(() => summarise(this.filteredGames(), 'loss'));
  protected readonly summaryWin = computed(() => summarise(this.filteredGames(), 'win'));

  /**
   * The bars stated as a conclusion, reading both sides at once.
   *
   * Not tied to the toggle on purpose: the useful sentence compares wins
   * against losses, and having to flip tabs to assemble it is the work this is
   * meant to remove.
   */
  protected readonly readout = computed(() => reviewReadout(this.filteredGames(), 'loss'));

  /** One line per factor, shown on hover rather than taking up layout. */
  protected factorHint(code: string): string {
    return FACTOR_GUIDE[code] ?? '';
  }

  /**
   * What to work on after this specific game, from the factors it actually
   * carries. Capped at three: a review with six action points is a review
   * nobody does.
   */
  // ---- Wins against losses: the tables and the two lists (8 Sep 2026) ----

  /** Roster order for the lane rows: starters by seat, then the subs. */
  private readonly rosterOrder = computed(() => {
    const seat = (r: string) => { const i = (['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as string[]).indexOf(r); return i < 0 ? 5 : i; };
    return [...this.data.players()].sort((a, b) => Number(!!a.sub) - Number(!!b.sub) || seat(a.role) - seat(b.role)).map((p) => p.name);
  });
  protected readonly workOnList = computed(() => workOn(this.filteredGames(), 'player', this.rosterOrder(), this.source()));
  protected readonly keepDoingList = computed(() => keepDoing(this.filteredGames(), 'player', this.rosterOrder(), this.source()));
  protected readonly laneRows = computed(() => laneTable(this.filteredGames(), 'player', this.rosterOrder()));
  protected readonly laneTotalRows = computed(() => laneTotals(this.filteredGames(), this.rosterOrder()));

  /** The overview line: what is counted, and the two things most worth a look. */
  protected readonly atAGlance = computed(() => {
    const lanes = this.laneRows();
    const worstLane = [...lanes.rows]
      .filter((r) => r.lostInLosses.n >= MIN_FOR_A_CLAIM)
      .sort((a, b) => b.lostInLosses.share - a.lostInLosses.share)[0];
    const biggest = [...this.teamSplitRows()]
      .filter((m) => m.split.gap !== undefined && m.split.wins.n >= MIN_FOR_A_CLAIM && m.split.losses.n >= MIN_FOR_A_CLAIM)
      .map((m) => ({ m, size: Math.abs(m.split.gap as number) / Math.max(Math.abs(m.split.wins.mean), Math.abs(m.split.losses.mean), 0.01) }))
      .sort((a, b) => b.size - a.size)[0]?.m;
    return { read: lanes.read, total: lanes.total, waiting: lanes.waiting, skipped: lanes.skipped, worstLane, biggest };
  });
  private readonly topStarter = computed(() => this.data.starters().find((p) => p.role === 'Top')?.name);
  protected readonly teamSplitRows = computed(() => teamSplits(this.filteredGames(), this.topStarter(), this.source()));
  protected readonly claimFloor = MIN_FOR_A_CLAIM;

  protected side(s: SideStat, unit: MetricSplit['unit'] | 'diff'): string {
    return formatSide(s, unit);
  }

  protected gapOf(m: { split: { gap?: number }; unit: MetricSplit['unit'] | 'diff' }): string {
    return formatGap(m);
  }

  protected gapGood(m: { split: { gap?: number }; higherIsBetter: boolean }): boolean | null {
    return gapIsGood(m);
  }

  protected laneNote(lane: LaneRead | undefined): string {
    if (!lane || lane.verdict === 'unknown') return '';
    const bits: string[] = [];
    if (lane.goldPerMinDiff !== undefined) bits.push(`${lane.goldPerMinDiff > 0 ? '+' : ''}${lane.goldPerMinDiff} g/min`);
    if (lane.csAt10Diff !== undefined) bits.push(`${lane.csAt10Diff > 0 ? '+' : ''}${lane.csAt10Diff} cs@10`);
    return bits.join(' · ');
  }

  protected adviceFor(game: AnalysisGame): string[] {
    return factorsOf(game)
      .map((factor) => FACTOR_ADVICE[game.win ? 'win' : 'loss'][factor.code])
      .filter((advice): advice is string => !!advice)
      .slice(0, 3);
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
  ): { position: string; champion: string; player: string; theirs: string | null; lane?: LaneRead }[] {
    if (!game.enemies?.length) return [];
    const theirs = new Map(game.enemies.map((e) => [e.position, e.champion]));
    return game.players.map((p) => ({
      position: p.position,
      champion: p.champion,
      // Our side names the player; the enemy side cannot. Resolving their
      // puuids would be a Riot call per player per game, and the icon already
      // says who they were.
      player: p.name,
      theirs: theirs.get(p.position) ?? null,
      ...(p.lane ? { lane: p.lane } : {})
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
