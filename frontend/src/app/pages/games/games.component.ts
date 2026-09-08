import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { effectiveComp } from '../../core/comp-alias';
import { AuthService } from '../../services/auth.service';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { CompAnalysisService } from '../../services/comp-analysis.service';
import { RefreshService } from '../../services/refresh.service';
import { TeamDataService } from '../../services/team-data.service';
import { UiService } from '../../services/ui.service';
import { ChampionFilterComponent } from '../../shared/champion-filter.component';
import { MatchNoteButtonComponent } from '../../shared/match-note-button.component';
import { MatchNoteComponent } from '../../shared/match-note.component';
import { NgModelNameDirective } from '../../shared/ng-model-name.directive';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { ReviewComponent } from '../review/review.component';
import {
  filterRows,
  fromAnalysis,
  fromScrim,
  fromSeriesGame,
  GameRow,
  GameSource,
  meanLength,
  playerLines,
  record,
  rosterIds,
  toughest
} from './game-rows';

type Tab = 'games' | 'patterns';

/**
 * Every game we played, in one place: tournament games, scrims and the flex
 * and Clash games Riot knows about, newest first, each opening to the match.
 *
 * Replaced the comp-first Analysis page and folded Review in as a second tab
 * on 8 Sep 2026. Comps keep their own records on the Comps page; here a comp
 * is a tag on a game, not the thing the page is organised around.
 */
@Component({
  selector: 'app-games',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    ChampionFilterComponent,
    MatchNoteComponent,
    MatchNoteButtonComponent,
    NgModelNameDirective,
    TooltipDirective,
    ReviewComponent
  ],
  templateUrl: './games.component.html'
})
export class GamesComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly refresh = inject(RefreshService);
  protected readonly filter = inject(ChampionFilterService);
  private readonly analysis = inject(CompAnalysisService);
  private readonly route = inject(ActivatedRoute);

  protected readonly tab = signal<Tab>('games');

  // ---- Filters ----------------------------------------------------------------

  protected readonly source = signal<GameSource | 'all'>('all');
  protected readonly days = signal(30);
  protected readonly result = signal<'all' | 'win' | 'loss'>('all');
  protected readonly opponent = signal('');
  /** A comp id from a Comps-page link; narrows to the games under that comp. */
  protected readonly comp = signal('');
  protected readonly windows = [
    { days: 7, label: '7 days' },
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
    { days: 0, label: 'All' }
  ];

  // ---- Rows -------------------------------------------------------------------

  /** Every game from every source, newest first. */
  protected readonly allRows = computed<GameRow[]>(() => {
    const comps = this.data.comps();
    const ours = rosterIds(this.data.players());
    const riot = (this.data.compAnalysis()?.games ?? []).map((g) =>
      fromAnalysis(g, effectiveComp(g.compId, this.data.compOverride(g.matchId), comps))
    );
    const riotIds = new Set(riot.map((r) => r.matchId));
    const scrims = this.data
      .scrims()
      .filter((s) => !riotIds.has(s.id))
      .map((s) => fromScrim(s, ours))
      .filter((r): r is GameRow => r !== null);
    const seriesById = new Map(this.data.tournamentSeries().map((s) => [s.id, s]));
    const tournament = this.data
      .seriesGames()
      .map((g) => fromSeriesGame(g, seriesById.get(g.seriesId)))
      .filter((r): r is GameRow => r !== null);
    return [...riot, ...scrims, ...tournament].sort((a, b) => b.date - a.date);
  });

  /** Everything but the source filter, so the per-source tiles always have their counts. */
  private readonly rowsAnySource = computed<GameRow[]>(() => {
    const comp = this.comp();
    const rows = comp ? this.allRows().filter((r) => r.compId === comp) : this.allRows();
    return filterRows(rows, {
      source: 'all',
      days: this.days(),
      result: this.result(),
      opponent: this.opponent(),
      champion: (c) => this.filter.passes(c)
    });
  });

  protected readonly rows = computed<GameRow[]>(() => {
    const source = this.source();
    return source === 'all' ? this.rowsAnySource() : this.rowsAnySource().filter((r) => r.source === source);
  });

  protected readonly opponents = computed<string[]>(() => {
    const seen = new Set<string>();
    for (const r of this.allRows()) if (r.opponent) seen.add(r.opponent);
    return [...seen].sort((a, b) => a.localeCompare(b));
  });

  protected readonly compName = computed(() => this.data.comps().find((c) => c.id === this.comp())?.name ?? '');

  // ---- Records ----------------------------------------------------------------

  protected readonly overall = computed(() => record(this.rows()));
  protected readonly bySource = computed(() =>
    (['tournament', 'scrim', 'riot'] as const).map((source) => ({
      source,
      label: source === 'riot' ? 'Flex & Clash' : source === 'scrim' ? 'Scrims' : 'Tournament',
      ...record(this.rowsAnySource().filter((r) => r.source === source))
    }))
  );
  protected readonly sides = computed(() => ({
    blue: record(this.rows().filter((r) => r.side === 'blue')),
    red: record(this.rows().filter((r) => r.side === 'red'))
  }));
  protected readonly form = computed(() => this.rows().slice(0, 10));
  protected readonly length = computed(() => meanLength(this.rows()));
  protected readonly players = computed(() => playerLines(this.rows()));
  protected readonly toughest = computed(() => toughest(this.rows()));

  // ---- Deep links: ?match= opens one Riot game, ?comp= narrows to a comp ----

  private revealed: string | null = null;

  constructor() {
    const tab = this.route.snapshot.data['tab'];
    if (tab === 'patterns') this.tab.set('patterns');
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const comp = params.get('comp');
      if (comp) {
        this.comp.set(comp);
        this.days.set(0);
      }
      const match = params.get('match');
      if (match) {
        this.tab.set('games');
        this.days.set(0);
        this.focus.set(`riot-${match}`);
      }
    });
    effect(() => {
      const id = this.focus();
      if (!id || this.revealed === id) return;
      if (!this.rows().some((r) => r.id === id)) return;
      this.revealed = id;
      // A timer, not requestAnimationFrame: a tab opened in the background
      // never gets a frame, and the link would land on a closed row.
      setTimeout(() => {
        const panel = document.querySelector<HTMLDetailsElement>(`[data-row="${CSS.escape(id)}"]`);
        if (!panel) return;
        panel.open = true;
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    });
  }

  protected readonly focus = signal<string | null>(null);

  protected clearComp(): void {
    this.comp.set('');
  }

  // ---- Row helpers ------------------------------------------------------------

  protected day(ms: number): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected clock(seconds: number | undefined): string {
    if (!seconds) return '';
    return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
  }

  protected compact(n: number | undefined): string {
    if (n === undefined) return '—';
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  }

  protected pct(share: number | undefined): string {
    return share === undefined ? '—' : `${Math.round(share * 100)}%`;
  }

  protected sourceLabel(source: GameSource): string {
    return source === 'riot' ? 'Riot' : source === 'scrim' ? 'Scrim' : 'Tournament';
  }

  protected setGameComp(matchId: string, compId: string): void {
    void this.data.saveCompOverride(matchId, compId);
  }

  // ---- Data: the refresh controls that lived on Analysis --------------------

  protected readonly analysisLoading = this.analysis.running;
  protected readonly analysisError = signal('');

  protected async refreshAnalysis(): Promise<void> {
    if (this.analysisLoading()) return;
    this.analysisError.set('');
    try {
      const result = await this.analysis.refresh(this.data.players(), this.data.comps(), this.data.compOverrideMap());
      this.data.compAnalysis.set(result);
    } catch (err) {
      this.analysisError.set(err instanceof Error ? err.message : 'Analysis failed.');
    }
  }
}
