import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { AnalysisGame, CompAnalysis, Scrim, SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { GamesComponent } from './games.component';

// Local mode, the way the comps page's spec does it: no listeners, no backend,
// and whatever the test sets on the signals is what the page reads.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

/** Inside the page's thirty-day window, so the default filter keeps the row. */
const TODAY = Date.now();

/** The lead's own example line: Jinx on 52.5k damage, 38 percent of ours, on 14 of 20 kills, dead twice. */
const riotGame = {
  matchId: 'EUW1_7000000001',
  compId: null,
  compName: null,
  win: true,
  queue: 'Flex',
  date: TODAY,
  durationSec: 1800,
  kills: { ours: 20, theirs: 35 },
  players: [
    { name: 'Bom', position: 'TOP', champion: 'Aatrox', kills: 4, deaths: 5, assists: 3, cs: 200, damage: 24000, killParticipation: 0.5 },
    { name: 'Go10x', position: 'JUNGLE', champion: 'MonkeyKing', kills: 5, deaths: 4, assists: 9, cs: 150, damage: 22000, killParticipation: 0.7 },
    { name: 'Kez', position: 'MIDDLE', champion: 'Ahri', kills: 6, deaths: 3, assists: 6, cs: 250, damage: 32000, killParticipation: 0.6 },
    { name: 'Rhu', position: 'BOTTOM', champion: 'Jinx', kills: 9, deaths: 2, assists: 5, cs: 312, damage: 52500, killParticipation: 0.7 },
    { name: 'Sen', position: 'UTILITY', champion: 'Leona', kills: 0, deaths: 6, assists: 11, cs: 40, damage: 8000, killParticipation: 0.55 }
  ]
} as unknown as AnalysisGame;

const scrimPlayer = (team: number, position: string, champion: string, name: string, kills: number, deaths: number, assists: number, damage: number) =>
  ({ team, position, champion, name, tag: 'EUW', win: team === 100, kills, deaths, assists, damage, gold: 0, damageToBuildings: 0, damageTaken: 0, visionScore: 0, cs: 0 }) as Scrim['players'][number];

/** A replay: every figure but kill participation, which no `.rofl` carries. */
const scrim = {
  id: 'EUW1_9000000002',
  playedOn: new Date(TODAY).toISOString(),
  durationSec: 1600,
  blueWon: true,
  ourSide: 'blue',
  opponent: 'MOSS',
  players: [
    scrimPlayer(100, 'TOP', 'Ornn', 'Bom', 1, 4, 3, 12000),
    scrimPlayer(100, 'JUNGLE', 'Vi', 'Go10x', 7, 2, 5, 30000),
    scrimPlayer(100, 'MIDDLE', 'Ahri', 'Kez', 3, 3, 6, 25000),
    scrimPlayer(100, 'BOTTOM', 'Jinx', 'Rhu', 4, 2, 5, 28000),
    scrimPlayer(100, 'UTILITY', 'Leona', 'Sen', 0, 5, 9, 8000),
    scrimPlayer(200, 'TOP', 'Gnar', 'Them1', 2, 3, 2, 14000),
    scrimPlayer(200, 'JUNGLE', 'Sejuani', 'Them2', 3, 5, 4, 20000),
    scrimPlayer(200, 'MIDDLE', 'Syndra', 'Them3', 5, 4, 3, 26000),
    scrimPlayer(200, 'BOTTOM', 'Caitlyn', 'Them4', 4, 3, 4, 24000),
    scrimPlayer(200, 'UTILITY', 'Nautilus', 'Them5', 0, 4, 8, 6000)
  ],
  order: 0
} as unknown as Scrim;

/** The roster, so a replay's teammate is named rather than left as "not on the roster". */
const roster = [{ id: 'p1', name: 'Go10x', role: 'Jungle', order: 0, profile: { riotTag: '#EUW' } }] as unknown as Parameters<TeamDataService['players']['set']>[0];

/** A tournament game typed into the draft room: ten champions and a result, no figures at all. */
const series = { id: 's1', tournamentId: 't1', opponent: 'MOSS', bestOf: 3, scheduledAt: new Date(TODAY).toISOString(), order: 0 } as unknown as TournamentSeries;
const seriesGame = {
  id: 'g1',
  seriesId: 's1',
  gameNumber: 1,
  ourChampions: ['Ornn', 'Vi', 'Ahri', 'Jinx', 'Leona'],
  theirChampions: ['Gnar', 'Sejuani', 'Syndra', 'Caitlyn', 'Nautilus'],
  win: true,
  order: 0
} as unknown as SeriesGame;

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The page renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('GamesComponent, the row\'s MVP chip', () => {
  let data: TeamDataService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'games', component: GamesComponent }])] });
    data = TestBed.inject(TeamDataService);
  });

  /**
   * The game list is open from the start (12 Sep 2026) — it used to be folded, and pressing that
   * fold was this helper's first act. The fold button itself is Full's now, so the helper opens the
   * page and the rows are simply there.
   */
  async function open(): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/games', GamesComponent);
    harness.detectChanges();
    return { harness, root: harness.routeNativeElement as HTMLElement };
  }

  function tipOf(harness: RouterTestingHarness, selector: string): string {
    return harness.fixture.debugElement.query(By.css(selector)).injector.get(TooltipDirective).appTip();
  }

  it('marks who carried the game on the row, compact, with the terms behind it in the tip', async () => {
    data.compAnalysis.set({ games: [riotGame], comps: [], totalTeamGames: 1, scannedMatches: 1, generatedAt: new Date(TODAY).toISOString() } as CompAnalysis);
    const { harness, root } = await open();
    const chip = root.querySelector(`[data-row="riot-${riotGame.matchId}"] summary .mvp-chip`)!;
    expect(text(chip.querySelector('.mvp-chip-word'))).toBe('MVP');
    // Compact on a row: the tile and the word, and the name in the tip where there is room for it.
    expect(chip.classList.contains('is-compact')).toBe(true);
    expect(chip.querySelector('.mvp-chip-name')).toBeNull();
    expect(tipOf(harness, '.mvp-chip')).toBe('MVP: Rhu on Jinx. 52.5k damage, 38% of ours · on 14 of 20 kills · died twice.');
  });

  it('reads a replay the same way, off the kills the file does carry rather than a participation it does not', async () => {
    data.players.set(roster);
    data.scrims.set([scrim]);
    const { harness, root } = await open();
    const chip = root.querySelector('[data-row="scrim-EUW1_9000000002"] summary .mvp-chip')!;
    expect(text(chip.querySelector('.mvp-chip-word'))).toBe('MVP');
    // Fifteen kills between our five on the file, and Vi was in on seven of her own and five of theirs.
    expect(tipOf(harness, '.mvp-chip')).toBe('MVP: Go10x on Vi. 30.0k damage, 29% of ours · on 12 of 15 kills · died twice.');
  });

  it('draws no chip on a tournament game typed in by hand, because it carries no figures to read', async () => {
    data.tournaments.set([{ id: 't1', name: 'Oryx', order: 0 } as unknown as Tournament]);
    data.tournamentSeries.set([series]);
    data.seriesGames.set([seriesGame]);
    const { root } = await open();
    const row = root.querySelector('[data-row="series-g1"]')!;
    expect(row).not.toBeNull();
    expect(row.querySelector('.mvp-chip')).toBeNull();
  });
});


/**
 * The tab named for reviews used to draw a poster per review and send the reader to the Games tab
 * to read one (12 Sep 2026). Reading the newest review cost about five clicks from login. The panel
 * is self-contained and was already imported by this page, so the fix was to mount it.
 */
describe.skipIf(typeof localStorage === 'undefined')('GamesComponent, the Reviews tab', () => {
  let data: TeamDataService;

  const review = (matchId: string, headline: string, reviewedAt: string) =>
    ({
      matchId,
      reviewedAt,
      reviewVersion: 8,
      tier: 'timeline',
      trigger: 'manual',
      models: { team: 'claude-opus-5', players: 'claude-opus-5' },
      compId: null,
      compName: null,
      team: { headline, summary: 's', workOn: [], keepDoing: [], compVerdict: 'unclear', compWhy: '' },
      players: [],
      usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0.25, tookMs: 1 }
    }) as unknown as Parameters<TeamDataService['gameReviews']['set']>[0][number];

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'games', component: GamesComponent }])] });
    data = TestBed.inject(TeamDataService);
  });

  async function openTab(): Promise<HTMLElement> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/games?tab=reviews', GamesComponent);
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  it('renders the review itself, newest first and open, and the rest collapsed', async () => {
    data.compAnalysis.set({ games: [riotGame], comps: [], totalTeamGames: 1, scannedMatches: 1, generatedAt: new Date(TODAY).toISOString() } as CompAnalysis);
    data.gameReviews.set([
      review('EUW1_7000000001', 'Newest headline', new Date(TODAY).toISOString()),
      review('EUW1_6000000000', 'Older headline', new Date(TODAY - 86_400_000).toISOString())
    ]);
    const root = await openTab();

    // The panel, not a picture of it.
    const panels = root.querySelectorAll('app-game-review');
    expect(panels.length).toBe(2);

    // The newest is open and the one below it is not: a reader lands on a review, not on a list.
    const folds = [...root.querySelectorAll('app-game-review details.game-review')] as HTMLDetailsElement[];
    expect(folds.map((d) => d.open)).toEqual([true, false]);
    expect(text(folds[0].querySelector('.game-review-headline'))).toBe('Newest headline');

    // The way back to the row survives, demoted: reading no longer needs it.
    expect(root.querySelectorAll('.review-card-open').length).toBe(2);
  });

  it('says so plainly when nothing has been reviewed', async () => {
    data.gameReviews.set([]);
    const root = await openTab();
    expect(root.querySelector('app-game-review')).toBeNull();
    expect(text(root.querySelector('.review-cards'))).toBe('');
  });
});


/**
 * A link to one game used to rewrite the whole page's window (12 Sep 2026). `?match=` called
 * `days.set(0)`, and `?match=` is how the film room's Back pill, the Reviews tab's "Open the game"
 * and every evidence link arrive — so the commonest way onto this page opened nine months of games
 * to show one row, and silently restated the team's record over all of it.
 */
describe.skipIf(typeof localStorage === 'undefined')('GamesComponent, a link to one game', () => {
  let data: TeamDataService;

  /** Well outside the thirty-day window the page opens on. */
  const OLD_DAY = TODAY - 200 * 86_400_000;
  const oldGame = { ...riotGame, matchId: 'EUW1_5000000005', date: OLD_DAY, win: false } as unknown as AnalysisGame;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'games', component: GamesComponent }])] });
    data = TestBed.inject(TeamDataService);
    data.compAnalysis.set({
      games: [riotGame, oldGame],
      comps: [],
      totalTeamGames: 2,
      scannedMatches: 2,
      generatedAt: new Date(TODAY).toISOString()
    } as CompAnalysis);
  });

  it('pins the game to the list and leaves the window and the record alone', async () => {
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/games?match=EUW1_5000000005', GamesComponent);
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;

    // The window never moved: the page still says thirty days.
    expect((page as unknown as { days: () => number }).days()).toBe(30);

    // The row asked for is on the list anyway, and says why it is there.
    const row = root.querySelector('[data-row="riot-EUW1_5000000005"]');
    expect(row).not.toBeNull();
    expect(text(row!.querySelector('.games-pinned'))).toBe('from a link');

    // And the record still counts the window only — one game, a win — not the pinned loss.
    expect(text(root.querySelector('.insight-tile.is-lead .insight-value'))).toContain('1W');
    expect(text(root.querySelector('.insight-tile.is-lead .insight-value'))).toContain('0L');
  });

  it('does not double the row or mark it when the window already holds it', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/games?match=EUW1_7000000001', GamesComponent);
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-row="riot-EUW1_7000000001"]').length).toBe(1);
    expect(root.querySelector('.games-pinned')).toBeNull();
  });
});


/**
 * Starter and Full on the Games tab (12 Sep 2026). Measured before it was built: 23 controls and
 * about 85 figures stood between a reader and the first game row, and the list itself was folded —
 * the page folding away the only thing on it that is the point.
 *
 * The rule, applied here and on every other surface: does a reader ACT on it, or CHECK it? The
 * record and the games are acted on; the Riot telemetry, the breakdown tiles and the ten-column
 * player table are checked, and they wait for Full.
 */
describe.skipIf(typeof localStorage === 'undefined')('GamesComponent, Starter and Full', () => {
  let data: TeamDataService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'games', component: GamesComponent }])] });
    data = TestBed.inject(TeamDataService);
    data.compAnalysis.set({ games: [riotGame], comps: [], totalTeamGames: 1, scannedMatches: 1, generatedAt: new Date(TODAY).toISOString() } as CompAnalysis);
  });

  async function page(): Promise<{ harness: RouterTestingHarness; root: HTMLElement; comp: { full: () => boolean } }> {
    const harness = await RouterTestingHarness.create();
    const comp = (await harness.navigateByUrl('/games', GamesComponent)) as unknown as { full: () => boolean };
    harness.detectChanges();
    return { harness, root: harness.routeNativeElement as HTMLElement, comp };
  }

  it('opens on Starter, with the games on screen and the furniture away', async () => {
    const { root, comp } = await page();
    expect(comp.full()).toBe(false);

    // The list is the page: rows without pressing anything.
    expect(root.querySelectorAll('.games-row').length).toBeGreaterThan(0);
    expect(root.querySelector('[data-tour="games-list-fold"]')).toBeNull();

    // What a reader checks rather than acts on is not here.
    expect(root.querySelector('.games-player-table')).toBeNull();
    expect(root.querySelector('.insight-tile.is-source')).toBeNull();
    expect(root.querySelector('[aria-label="Result"]')).toBeNull();

    // The record and the window are: the answer, and the one filter a coach actually changes.
    expect(root.querySelector('.insight-tile.is-lead')).not.toBeNull();
    expect(root.querySelector('[aria-label="Window"]')).not.toBeNull();
  });

  it('gives all of it back on Full, and the fortnight is a window you can pick', async () => {
    const { harness, root } = await page();
    const full = [...root.querySelectorAll<HTMLButtonElement>('app-detail-toggle button')].find((b) => b.textContent?.trim() === 'Full')!;
    full.click();
    harness.detectChanges();

    expect(root.querySelector('.games-player-table')).not.toBeNull();
    expect(root.querySelector('.insight-tile.is-source')).not.toBeNull();
    expect(root.querySelector('[aria-label="Result"]')).not.toBeNull();
    expect(root.querySelector('[data-tour="games-list-fold"]')).not.toBeNull();

    const windows = [...root.querySelectorAll('[aria-label="Window"] button')].map((b) => (b.textContent ?? '').trim());
    expect(windows).toEqual(['7 days', '14 days', '30 days', '90 days', 'All']);
  });
});
