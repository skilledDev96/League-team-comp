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
import { ColumnOption, ColumnPickerComponent } from '../../shared/column-picker.component';
import { SplitCellComponent } from '../../shared/split-cell.component';
import { SplitViewToggleComponent } from '../../shared/split-view-toggle.component';
import { TablePrefsService } from '../../services/table-prefs.service';
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
import { formatGap, formatSide, gameSource, GameSource, gapIsGood, keepDoing, laneTable, laneTotals, MetricSplit, PatternSource, roleFit, RoleMode, SideStat, sourceOf, starterCount, teamSplits, workOn } from './win-loss-splits';
import { InfoTipComponent } from '../../shared/info-tip.component';

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
  imports: [DatePipe, NgTemplateOutlet, RouterLink, TooltipDirective, ChampionFilterComponent, GameCheckComponent, ColumnPickerComponent, SplitCellComponent, SplitViewToggleComponent, InfoTipComponent],
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
   * Who has to be in the game: the A team (everyone not on the bench, set on
   * the Roster page), or a hand-picked set — tick three players and the games
   * those three played together count (8 Sep 2026).
   */
  protected readonly starterMode = signal<'team' | 'custom'>('team');
  protected readonly customPlayers = signal<ReadonlySet<string>>(new Set());
  private readonly starterNames = computed(() => this.data.starters().map((p) => p.name));

  protected toggleCustom(name: string): void {
    this.customPlayers.update((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /** Main seat only, main or a second seat, or anywhere — as set on the Roster page. */
  protected readonly roleMode = signal<RoleMode>('main');
  protected readonly roleSteps: { mode: RoleMode; label: string; tip: string }[] = [
    { mode: 'main', label: 'Main', tip: 'Games where all of ours sat in their main seat — the role in each player’s title, set on the Roster card in edit mode. A 0 means every game had someone off-role.' },
    { mode: 'second', label: '2nd', tip: 'Main seat or a second seat they are listed for' },
    { mode: 'any', label: 'Any', tip: 'Whoever sat where' }
  ];
  private readonly rosterRoles = computed(() => this.data.players().map((p) => ({ name: p.name, role: p.role, secondaryRoles: p.secondaryRoles })));

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
   * Where the games came from, the way the team sorts them: the flex ladder,
   * Clash with the scrims as practice, and tournament games (replays imported
   * against a series game). Flex first, because that is where the lane
   * reads are. Whether the read is Riot's or a replay's follows from the
   * games themselves (`patternSource`).
   */
  protected readonly sourceMode = signal<GameSource>('flex');
  protected readonly sourceSteps: { source: GameSource; label: string; tip: string }[] = [
    { source: 'flex', label: 'Flex', tip: 'Ranked flex: per-minute figures, lane reads, the lot' },
    { source: 'scrimClash', label: 'Scrims + Clash', tip: 'Practice against a team: scrims from replay files and Clash' },
    { source: 'tournament', label: 'Tournaments', tip: 'Replays imported against a tournament game' }
  ];
  private readonly tournamentIds = computed(() => new Set(this.data.seriesGames().map((g) => g.matchId).filter((id): id is string => !!id)));
  protected gamesAtSource(source: GameSource): number {
    const ids = this.tournamentIds();
    return this.seriousGames().filter((g) => gameSource(g, ids) === source).length;
  }

  private readonly anyStackGames = computed<AnalysisGame[]>(() => {
    const source = this.sourceMode();
    const ids = this.tournamentIds();
    return this.seriousGames().filter((g) => gameSource(g, ids) === source);
  });

  /** Riot's read or a replay's: replays when nothing in the selection carries per-minute figures. */
  protected readonly patternSource = computed<PatternSource>(() =>
    this.filteredGames().some((g) => sourceOf(g) === 'riot') ? 'riot' : 'replay'
  );

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

  /** Games with the right people in, before the role question. */
  private readonly starterGames = computed<AnalysisGame[]>(() => {
    const games = this.anyStackGames();
    if (this.starterMode() === 'custom') {
      const picked = [...this.customPlayers()];
      return picked.length ? games.filter((g) => starterCount(g, picked) >= picked.length) : games;
    }
    const starters = this.starterNames();
    return starters.length ? games.filter((g) => starterCount(g, starters) >= starters.length) : games;
  });

  protected readonly filteredGames = computed<AnalysisGame[]>(() => {
    const mode = this.roleMode();
    if (mode === 'any') return this.starterGames();
    const roster = this.rosterRoles();
    return this.starterGames().filter((g) => roleFit(g, roster, mode));
  });

  protected gamesAtRole(mode: RoleMode): number {
    if (mode === 'any') return this.starterGames().length;
    const roster = this.rosterRoles();
    return this.starterGames().filter((g) => roleFit(g, roster, mode)).length;
  }

  protected gamesAtStarters(mode: 'team' | 'custom'): number {
    const games = this.anyStackGames();
    if (mode === 'custom') {
      const picked = [...this.customPlayers()];
      return picked.length ? games.filter((g) => starterCount(g, picked) >= picked.length).length : games.length;
    }
    const starters = this.starterNames();
    return starters.length ? games.filter((g) => starterCount(g, starters) >= starters.length).length : games.length;
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
  protected readonly workOnList = computed(() => workOn(this.filteredGames(), 'player', this.rosterOrder(), this.patternSource()));
  protected readonly keepDoingList = computed(() => keepDoing(this.filteredGames(), 'player', this.rosterOrder(), this.patternSource()));
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
  protected readonly teamSplitRows = computed(() => teamSplits(this.filteredGames(), this.topStarter(), this.patternSource()));
  protected readonly claimFloor = MIN_FOR_A_CLAIM;

  // ---- Which columns each table shows, and how the figures read ----
  protected readonly prefs = inject(TablePrefsService);
  protected readonly laneColumns: ColumnOption[] = [
    { key: 'lost', label: 'Lost lane' },
    { key: 'won', label: 'Won lane' },
    { key: 'gold', label: 'Gold/min vs lane' },
    { key: 'cs', label: 'CS at 10 vs lane' }
  ];
  protected readonly laneDefaults = this.laneColumns.map((c) => c.key);
  protected readonly totalColumns: ColumnOption[] = [
    { key: 'goldShare', label: 'Gold share' },
    { key: 'csPerMin', label: 'CS/min' },
    { key: 'damageShare', label: 'Damage share' },
    { key: 'deaths', label: 'Deaths' }
  ];
  protected readonly totalDefaults = this.totalColumns.map((c) => c.key);
  protected readonly teamColumns = computed<ColumnOption[]>(() => this.teamSplitRows().map((m) => ({ key: m.key, label: m.label })));
  protected readonly teamDefaults = computed(() => this.teamColumns().map((c) => c.key));
  protected readonly shownTeamRows = computed(() => {
    const on = new Set(this.prefs.visibleFor()('team', this.teamDefaults()));
    return this.teamSplitRows().filter((m) => on.has(m.key));
  });
  protected on(table: string, key: string, defaults: readonly string[]): boolean {
    return this.prefs.visibleFor()(table, defaults).includes(key);
  }

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
