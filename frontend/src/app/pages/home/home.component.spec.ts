import { Component } from '@angular/core';
import { DeferBlockState, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { AnalysisGame, Comp, CompAnalysis, Player, Scrim, SeriesGame, Tournament, TournamentSeries } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { TournamentContextService } from '../tournaments/tournament-context.service';
import { HomeComponent } from './home.component';

// Local mode, as the Games page's spec runs: no listeners, and the signals the test sets are what the page reads.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

@Component({ selector: 'app-stub', template: '' })
class StubComponent {}

const NOW = Date.now();
const DAY = 86_400_000;

const players = (
  [
    ['p-top', 'Zac', 'Top', 'Aatrox'],
    ['p-jg', 'Go10x', 'Jungle', 'Vi'],
    ['p-mid', 'Mido', 'Mid', 'Ahri'],
    ['p-adc', 'SkilledScarecrow', 'ADC', 'Jinx'],
    ['p-sup', 'Suppy', 'Support', 'Leona']
  ] as const
).map(([id, name, role, main], order) => ({ id, name, role, order, top3: [main], profile: { riotTag: 'EUW' } }) as unknown as Player);

const tournaments = [{ id: 'cup', name: 'Oryx Fearless', kind: 'tournament', order: 0, startDate: new Date(NOW - 20 * DAY).toISOString().slice(0, 10), active: true }] as unknown as Tournament[];
const series = [
  { id: 'a', tournamentId: 'cup', opponent: 'Tidal Wolves', bestOf: 3, order: 0 },
  { id: 'b', tournamentId: 'cup', opponent: 'Iron Owls', bestOf: 3, order: 1, scheduledAt: new Date(NOW + 3 * DAY).toISOString().slice(0, 16) }
] as unknown as TournamentSeries[];

const THEIRS = ['RivalTop', 'RivalJungle', 'RivalMid', 'RivalBot', 'RivalSupport'];
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const replay = (id: string, playedOn: number): Scrim =>
  ({
    id,
    playedOn: new Date(playedOn).toISOString(),
    durationSec: 1700,
    blueWon: true,
    ourSide: 'blue',
    order: 0,
    players: [
      ...players.map((p, k) => ({ name: p.name, tag: 'EUW', champion: ['Aatrox', 'Vi', 'Ahri', 'MissFortune', 'Leona'][k], team: 100, win: true, position: POSITIONS[k], kills: k === 3 ? 12 : 2, deaths: k === 3 ? 1 : 3, assists: 6, gold: 0, damage: k === 3 ? 34_000 : 11_000, damageToBuildings: 0, damageTaken: 0, visionScore: 0, cs: 0 })),
      ...THEIRS.map((name, k) => ({ name, tag: 'RIV', champion: ['Gnar', 'Sejuani', 'Syndra', 'Caitlyn', 'Nautilus'][k], team: 200, win: false, position: POSITIONS[k], kills: 2, deaths: 4, assists: 3, gold: 0, damage: 12_000, damageToBuildings: 0, damageTaken: 0, visionScore: 0, cs: 0 }))
    ]
  }) as unknown as Scrim;
const games = [1, 2].map((n) => ({ id: `a${n}`, seriesId: 'a', gameNumber: n, win: true, matchId: `rep-${n}`, ourSide: 'blue', ourChampions: [], theirChampions: [] }) as unknown as SeriesGame);

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe.skipIf(typeof localStorage === 'undefined')('HomeComponent', () => {
  let data: TeamDataService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'home', component: HomeComponent }, { path: 'tournaments', component: StubComponent }])]
    });
    data = TestBed.inject(TeamDataService);
    data.players.set(players);
    data.tournaments.set(tournaments);
    data.tournamentSeries.set(series);
    data.seriesGames.set([]);
    data.scrims.set([]);
    data.compAnalysis.set(null);
  });

  async function open(): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/home', HomeComponent);
    harness.detectChanges();
    return { harness, root: harness.routeNativeElement as HTMLElement };
  }

  it('draws the empties on purpose: no record, the first crown to win, every starter in the race', async () => {
    const { root } = await open();
    expect(text(root.querySelector('.home-hero h1'))).toBe(data.settings().teamName || 'Bom Squad');
    expect(text(root.querySelector('.home-hero-empty'))).toContain('The record starts');
    expect(text(root.querySelector('.home-spotlight'))).toContain('The first finished series crowns the first MVP');
    expect(root.querySelectorAll('.home-race-row')).toHaveLength(5);
    expect(text(root.querySelector('.home-race-foot'))).toContain('The first finished series crowns the first MVP');
  });

  it('crowns the MVP of a finished Bo3 in the spotlight and names them at the foot of the race', async () => {
    data.seriesGames.set(games);
    data.scrims.set([replay('rep-1', NOW - 2 * DAY), replay('rep-2', NOW - 2 * DAY + 3_600_000)]);
    const { root } = await open();
    expect(text(root.querySelector('.home-spotlight-name'))).toBe('SkilledScarecrow');
    expect(text(root.querySelector('.home-spotlight-meta'))).toContain('Won 2–0 vs Tidal Wolves');
    expect(text(root.querySelector('.home-race-row.is-leader .home-race-who b'))).toBe('SkilledScarecrow');
    expect(text(root.querySelector('.home-race-last'))).toContain('Last series MVP: SkilledScarecrow on Miss Fortune vs Tidal Wolves');
    // The replays carry the other side's Riot ids; the page never prints one.
    for (const name of THEIRS) expect(root.innerHTML).not.toContain(name);
  });

  it('offers Scout them on the next series, which opens its prep and never the draft room', async () => {
    // The first series is over, so the next one is the second.
    data.seriesGames.set(games);
    const { harness, root } = await open();
    const ctx = TestBed.inject(TournamentContextService);
    const pill = [...root.querySelectorAll<HTMLButtonElement>('.home-next button')].find((b) => text(b) === 'travel_explore Scout them');
    expect(pill, 'the Scout them pill').toBeTruthy();
    expect(text(root.querySelector('.home-next-vs'))).toBe('vs Iron Owls');
    pill!.click();
    await harness.fixture.whenStable();
    expect(ctx.prepRequest()).toBe('b');
    expect(ctx.view()).toBe('plan');
    expect(TestBed.inject(Router).url).toBe('/tournaments?view=plan');
  });

  it('greets the starter in the reader seat', async () => {
    const { harness, root } = await open();
    TestBed.inject(UserPrefsService).prefs.set({ film: { seat: 'Jungle' } });
    harness.detectChanges();
    expect(text(root.querySelector('.home-welcome-greeting'))).toMatch(/, Go10x$/);
    expect(root.querySelector('.home-seat-ask')).toBeNull();
  });

  it('asks for a seat, and remembers Not now', async () => {
    const { harness, root } = await open();
    const later = [...root.querySelectorAll<HTMLButtonElement>('.home-seat-ask button')].find((b) => text(b) === 'Not now')!;
    later.click();
    harness.detectChanges();
    expect(root.querySelector('.home-seat-ask')).toBeNull();
    expect(localStorage.getItem('bom-home-seat-dismissed')).toBe('1');
  });

  it('keeps its tour anchors, and no link whose name holds "comps" (the e2e sign-in check matches substrings)', async () => {
    const { root } = await open();
    expect(root.querySelector('[data-tour="home-hero"]')).not.toBeNull();
    expect(root.querySelector('[data-tour="home-spotlight"]')).not.toBeNull();
    const names = [...root.querySelectorAll('a, [role="link"]')].map((a) => text(a).toLowerCase());
    expect(names.filter((n) => n.includes('comps'))).toEqual([]);
  });
  it('lands the bento: the five in the lineup, the comp of the month by name, and the trophy cabinet last', async () => {
    const engage = { id: 'engage', name: 'Engage', picks: { Top: 'Ornn', Jungle: 'Sejuani', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona' } } as unknown as Comp;
    const flex = (i: number, win: boolean): AnalysisGame =>
      ({
        matchId: 'EUW1_' + i,
        compId: 'engage',
        compName: 'Engage',
        win,
        queue: 'Flex',
        date: NOW - (i + 1) * DAY,
        durationSec: 1800,
        players: players.map((p, k) => ({ name: p.name, position: p.role, champion: ['Ornn', 'Sejuani', 'Orianna', 'Jinx', 'Leona'][k], kills: 3, deaths: 2, assists: 6, cs: 150, damage: 15_000 })),
        enemies: []
      }) as unknown as AnalysisGame;
    data.comps.set([engage]);
    data.trophies.set([{ id: 'won-1', title: 'Split 1 champions', placement: 1, date: '2026-06-28', order: 0 }]);
    data.compAnalysis.set({ games: [flex(1, true), flex(2, true), flex(3, false)], comps: [], totalTeamGames: 3, scannedMatches: 3, generatedAt: new Date(NOW).toISOString() } as CompAnalysis);
    const { harness, root } = await open();
    const [bento] = await harness.fixture.getDeferBlocks();
    expect(bento, 'the bento is deferred').toBeTruthy();
    await bento.render(DeferBlockState.Complete);
    harness.detectChanges();
    const cells = [...root.querySelectorAll('app-home-tiles .home-cell')].map((c) => c.className.replace(/^home-cell home-cell-/, ''));
    expect(cells.at(-1)).toBe('trophies');
    // What the team entered by hand stands first in the cabinet, with its medal.
    const cabinet = root.querySelector('.home-trophies')!;
    expect(cabinet.querySelector('ul')!.classList.contains('home-won')).toBe(true);
    expect(text(cabinet.querySelector('.home-won-card.is-gold .home-won-text b'))).toBe('Split 1 champions');
    expect(root.querySelectorAll('.home-lineup-card')).toHaveLength(5);
    expect(text(root.querySelector('.home-comp-name'))).toBe('Engage');
    expect(text(root.querySelector('.home-comp-rate'))).toContain('67%');
    // The comp opens by a button: a second link named for Comps would make the e2e nav locator ambiguous.
    const names = [...root.querySelectorAll('a')].map((a) => text(a).toLowerCase());
    expect(names.filter((n) => n.includes('comps'))).toEqual([]);
  });
});
