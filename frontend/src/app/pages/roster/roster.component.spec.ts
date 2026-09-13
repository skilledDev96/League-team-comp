import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { amsterdamToday } from '../../core/rank-ladder';
import { FillIn, OpponentPlayer, PainPoint, Player, Scrim, SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { TeamDataService } from '../../services/team-data.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { RosterComponent } from './roster.component';

// Local mode, as the Home page's spec runs: no listeners, and the signals the test sets are what the page reads.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const players = (
  [
    ['p-top', 'Zac', 'Top', 'Aatrox'],
    ['p-jg', 'Go10x', 'Jungle', 'Vi'],
    ['p-mid', 'Mido', 'Mid', 'Ahri'],
    ['p-adc', 'SkilledScarecrow', 'ADC', 'Jinx'],
    ['p-sup', 'Suppy', 'Support', 'Leona']
  ] as const
)
  .map(([id, name, role, main], order) => ({ id, name, role, order, top3: [main], strengths: ['Teamfights'], weaknesses: ['Early deaths'], bans: [], profile: { riotTag: 'EUW' }, ...(id === 'p-top' ? { queueStats: { solo: { rank: { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I', leaguePoints: 20, wins: 30, losses: 25, winRate: 55 } } } } : {}) }) as unknown as Player)
  .concat([{ id: 'p-sub', name: 'Benchy', role: 'Top', order: 9, sub: true, top3: ['Ornn'], strengths: [], weaknesses: [], bans: [] } as unknown as Player]);

const tournaments = [{ id: 'cup', name: 'Oryx Fearless', kind: 'tournament', order: 0, startDate: '2026-09-01', active: true }] as unknown as Tournament[];
const series = [{ id: 'a', tournamentId: 'cup', opponent: 'Tidal Wolves', bestOf: 3, order: 0 }] as unknown as TournamentSeries[];
const THEIRS = ['RivalTop', 'RivalJungle', 'RivalMid', 'RivalBot', 'RivalSupport'];
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const replay = (id: string, playedOn: string): Scrim =>
  ({
    id, playedOn, durationSec: 1700, blueWon: true, ourSide: 'blue', order: 0,
    players: [
      ...players.slice(0, 5).map((p, k) => ({ name: p.name, tag: 'EUW', champion: ['Aatrox', 'Vi', 'Ahri', 'MissFortune', 'Leona'][k], team: 100, win: true, position: POSITIONS[k], kills: k === 3 ? 12 : 2, deaths: k === 3 ? 1 : 3, assists: 6, gold: 0, damage: k === 3 ? 34_000 : 11_000, damageToBuildings: 0, damageTaken: 0, visionScore: 0, cs: 0 })),
      ...THEIRS.map((name, k) => ({ name, tag: 'RIV', champion: 'Garen', team: 200, win: false, position: POSITIONS[k], kills: 2, deaths: 4, assists: 3, gold: 0, damage: 12_000, damageToBuildings: 0, damageTaken: 0, visionScore: 0, cs: 0 }))
    ]
  }) as unknown as Scrim;
const games = [1, 2].map((n) => ({ id: `a${n}`, seriesId: 'a', gameNumber: n, win: true, matchId: `rep-${n}`, ourSide: 'blue', ourChampions: [], theirChampions: [] }) as unknown as SeriesGame);

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe.skipIf(typeof localStorage === 'undefined')('RosterComponent, the team poster', () => {
  let data: TeamDataService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'roster', component: RosterComponent }])] });
    data = TestBed.inject(TeamDataService);
    data.players.set(players);
    data.fillIns.set([{ id: 'f1', summoner: 'Ringer', status: 'On call', preferredRoles: ['Mid'], order: 0 } as unknown as FillIn]);
    data.painPoints.set([{ id: 'pp1', playerId: 'p-adc', text: 'Wave before roam', resolved: false, order: 0 } as PainPoint]);
    data.learnEntries.set([]);
    data.tournaments.set(tournaments);
    data.tournamentSeries.set(series);
    data.seriesGames.set(games);
    data.scrims.set([replay('rep-1', '2026-09-06T19:40:00Z'), replay('rep-2', '2026-09-06T20:30:00Z')]);
    data.compAnalysis.set(null);
  });

  async function open(url = '/roster'): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, RosterComponent);
    harness.detectChanges();
    return { harness, root: harness.routeNativeElement as HTMLElement };
  }

  const opener = (root: HTMLElement, i: number) => root.querySelectorAll<HTMLButtonElement>('.roster-poster .roster-panel-open')[i];

  it('stands the A team five across in seat order, crowns the series MVP, and names nobody of theirs', async () => {
    const { root } = await open();
    expect([...root.querySelectorAll('.roster-poster .roster-panel-open')].map((b) => text(b))).toEqual(['Zac', 'Go10x', 'Mido', 'SkilledScarecrow', 'Suppy']);
    const crowned = root.querySelector('.roster-poster .roster-panel.is-crowned')!;
    expect(text(crowned.querySelector('.roster-panel-open'))).toBe('SkilledScarecrow');
    expect(text(crowned.querySelector('.splash-chip'))).toBe('1 MVP title');
    expect(crowned.querySelectorAll('.form-pip.is-win')).toHaveLength(2);
    expect(root.querySelectorAll('.roster-tiles .roster-panel')).toHaveLength(2);
    expect(root.querySelector('.roster-sheet')).toBeNull();
    for (const name of THEIRS) expect(root.innerHTML).not.toContain(name);
  });

  it('keeps the toolbar one slim row, and answers from the pool the cards light up by', async () => {
    // SkilledScarecrow lists Jinx and played Miss Fortune for the team; the answer used to read the list alone.
    localStorage.setItem(
      'bom-ddragon-v1',
      JSON.stringify({ version: '15.1.1', champions: [{ id: 'MissFortune', key: '21', name: 'Miss Fortune', title: '', tags: ['Marksman'] }, { id: 'Jinx', key: '222', name: 'Jinx', title: '', tags: ['Marksman'] }] })
    );
    const { harness, root } = await open();
    expect(root.querySelector('.view-controls-count')).toBeNull();
    TestBed.inject(ChampionFilterService).set('Miss Fortune');
    harness.detectChanges();
    expect(text(root.querySelector('.champ-filter-answer'))).toBe('Played by SkilledScarecrow — from their team games and the pools listed for them.');
    expect(root.querySelector('.champ-filter-count')).toBeNull();
    const panels = [...root.querySelectorAll('.roster-poster .roster-panel')];
    expect(panels[3].classList).toContain('is-match');
    expect(panels[0].classList).toContain('is-dimmed');
  });

  it("shows the week's rank change and when they last played on the cards, and nothing where it is not known", async () => {
    const today = amsterdamToday();
    const daysAgo = (n: number) => new Date(Date.parse(today + 'T12:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
    const point = (day: string, division: string, lp: number) => ({ day, queue: 'solo', tier: 'GOLD', division, lp, wins: 0, losses: 0 });
    localStorage.setItem('bom-dev-rank-history:p-top', JSON.stringify({ playerId: 'p-top', updatedAt: today, points: [point(daysAgo(6), 'II', 80), point(today, 'I', 20)] }));
    const { harness, root } = await open();
    await harness.fixture.whenStable();
    harness.detectChanges();
    const zac = root.querySelectorAll('.roster-poster .roster-panel')[0];
    expect(text(zac.querySelector('.roster-panel-trend.is-up'))).toContain('+40');
    expect(root.querySelectorAll('.roster-panel-trend')).toHaveLength(1);
    expect(text(zac.querySelector('.roster-panel-ago'))).toMatch(/^· played (today|yesterday|\d+ (days|weeks|months) ago)$/);
    // Benchy has played no team game: no "played" at all rather than a guess.
    expect(root.querySelector('.roster-tiles .roster-panel .roster-panel-ago')).toBeNull();
  });

  it('opens one sheet at a time, switches between players, and closes on a second click or Escape', async () => {
    const { harness, root } = await open();
    opener(root, 1).click();
    harness.detectChanges();
    expect(root.querySelectorAll('.roster-sheet')).toHaveLength(1);
    expect(text(root.querySelector('#roster-sheet-title'))).toBe('Go10x');
    expect(opener(root, 1).getAttribute('aria-expanded')).toBe('true');
    opener(root, 3).click();
    harness.detectChanges();
    expect(root.querySelectorAll('.roster-sheet')).toHaveLength(1);
    expect(text(root.querySelector('#roster-sheet-title'))).toBe('SkilledScarecrow');
    expect(text(root.querySelector('.roster-work'))).toContain('Wave before roam');
    opener(root, 3).click();
    harness.detectChanges();
    expect(root.querySelector('.roster-sheet')).toBeNull();
    opener(root, 0).click();
    harness.detectChanges();
    root.querySelector('.roster-sheet')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    harness.detectChanges();
    expect(root.querySelector('.roster-sheet')).toBeNull();
  });

  it('at Full opens the first starter and adds each panel its numbers; back at Starter the sheet goes', async () => {
    const { harness, root } = await open();
    const prefs = TestBed.inject(UserPrefsService);
    prefs.prefs.set({ depth: { roster: 'full' } });
    harness.detectChanges();
    expect(text(root.querySelector('#roster-sheet-title'))).toBe('Zac');
    expect(root.querySelectorAll('.roster-panel-check').length).toBeGreaterThan(0);
    prefs.prefs.set({});
    harness.detectChanges();
    expect(root.querySelector('.roster-sheet')).toBeNull();
    expect(root.querySelector('.roster-panel-check')).toBeNull();
  });

  it('keeps the edit controls in the sheet, and a player benched from theirs moves under the poster with it', async () => {
    const { harness, root } = await open();
    TestBed.inject(AuthService).editMode.set(true);
    harness.detectChanges();
    expect(root.querySelector('[data-tour="roster-ateam"]')).toBeNull();
    opener(root, 0).click();
    harness.detectChanges();
    const toggle = root.querySelector<HTMLButtonElement>('[data-tour="roster-ateam"]');
    expect(toggle, 'the A team toggle in the sheet').not.toBeNull();
    toggle!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(root.querySelectorAll('.roster-poster .roster-panel')).toHaveLength(4);
    expect(text(root.querySelector('#roster-sheet-title'))).toBe('Zac');
    expect(text(root.querySelector('.roster-sheet')!.closest('.roster-group')!.querySelector('h2'))).toBe('Bench');
  });

  it('draws the table with a splash stripe a row and the crown on the series MVP', async () => {
    const { root } = await open('/roster?view=table');
    const rows = [...root.querySelectorAll('a.profiles-row')];
    expect(rows.length).toBe(6);
    expect(root.querySelectorAll('a.profiles-row img.profiles-row-art').length).toBe(6);
    const crowned = root.querySelectorAll('a.profiles-row.is-crowned');
    expect(crowned).toHaveLength(1);
    expect(text(crowned[0].querySelector('.pp-name'))).toContain('SkilledScarecrow');
    for (const name of THEIRS) expect(root.innerHTML).not.toContain(name);
  });

  it('gives every scouting card a splash band header that is still its one toggle', async () => {
    const { harness, root } = await open('/roster?view=scouting');
    const cards = [...root.querySelectorAll('article.player-intel-card')];
    expect(cards.length).toBe(6);
    const adc = cards.find((c) => text(c.querySelector('.pp-name')).includes('SkilledScarecrow'))!;
    expect(adc.classList).toContain('is-crowned');
    expect(adc.querySelector('.player-panel-header img.splash-art')).not.toBeNull();
    expect(text(adc.querySelector('.role-pill'))).toBe('ADC');
    expect(text(adc.querySelector('.intel-working'))).toBe('1 working on');
    const header = adc.querySelector<HTMLButtonElement>('.player-panel-header')!;
    expect(header.getAttribute('aria-expanded')).toBe('false');
    header.click();
    harness.detectChanges();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(adc.classList).toContain('expanded');
  });

  it('draws the scout report ban board as splash tiles and each of our five on a splash line', async () => {
    const scouted = players.slice(0, 5).map(
      (p, k) =>
        ({
          role: p.role,
          name: p.name,
          riotTag: 'EUW',
          byQueue: { flex: { championRecords: [{ champion: ['Aatrox', 'Vi', 'Ahri', 'MissFortune', 'Leona'][k], games: 20 - k, wins: 12 }] } }
        }) as unknown as OpponentPlayer
    );
    data.selfScout.set({ players: scouted, scoutedAt: '2026-09-12T08:00:00Z' });
    const { root } = await open('/roster?view=report');
    const tiles = [...root.querySelectorAll('.report-banboard .report-ban')];
    expect(tiles).toHaveLength(5);
    expect(tiles.every((t) => t.querySelector('img.splash-art'))).toBe(true);
    expect(text(tiles[0].querySelector('.report-ban-champ'))).toBe('Aatrox');
    expect(root.querySelector('.opp-banboard')).toBeNull();
    const five = root.querySelector('[data-tour="roster-report-five"]')!;
    expect(five.querySelectorAll('.opp-line img.report-line-art')).toHaveLength(5);
    expect(text(five.querySelector('.opp-line.is-crowned .opp-line-name'))).toContain('SkilledScarecrow');
  });

  it('keeps its tour anchors, and no link whose name holds "comps" (the e2e sign-in check matches substrings)', async () => {
    const { harness, root } = await open();
    for (const anchor of ['roster-views', 'quick-actions', 'roster-card', 'detail-roster']) {
      expect(root.querySelector(`[data-tour="${anchor}"]`), anchor).not.toBeNull();
    }
    opener(root, 0).click();
    harness.detectChanges();
    expect(root.querySelector('[data-tour="roster-sheet"]')).not.toBeNull();
    const names = [...root.querySelectorAll('a')].map((a) => text(a).toLowerCase());
    expect(names.filter((n) => n.includes('comps'))).toEqual([]);
  });
});
