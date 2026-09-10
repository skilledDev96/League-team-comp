import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AnalysisGame, GameReview, MatchTimeline } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { MatchTimelineService } from '../../services/match-timeline.service';
import { TeamDataService } from '../../services/team-data.service';
import { UserPrefsService } from '../../services/user-prefs.service';
import { FilmComponent } from './film.component';

// Local mode, the way the service spec does it: no listeners, no backend, and
// whatever the test sets on the signals is what the page reads.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const ID = 'EUW1_7000000001';

/** Where Back lands: the Games page stands in for itself, since only the url is asserted. */
@Component({ selector: 'app-games-stub', template: '<p class="games-stub">Games</p>' })
class GamesStub {}

const ROUTES = [
  { path: 'film/:matchId', component: FilmComponent },
  { path: 'games', component: GamesStub }
];

const point =(text: string, theme?: string, minute: number | null = null) => ({ text, evidence: 'kills 14-35 · 312 CS', minute, theme });

const game = {
  matchId: ID,
  date: 1757400000000,
  queue: 'Flex',
  win: false,
  durationSec: 34 * 60,
  kills: { ours: 14, theirs: 35 },
  players: [
    { name: 'Go10x#EUW', position: 'JUNGLE', champion: 'Trundle', kills: 3, deaths: 1, assists: 6, cs: 223, damage: 1, killParticipation: 0.64 },
    { name: 'Rhu#BOM', position: 'BOTTOM', champion: 'Jinx', kills: 8, deaths: 3, assists: 2, cs: 312, damage: 1, killParticipation: 0.71 },
    { name: 'Nia#BOM', position: 'UTILITY', champion: 'Leona', kills: 1, deaths: 2, assists: 9, cs: 30, damage: 1, killParticipation: 0.7 }
  ]
} as unknown as AnalysisGame;

const review = {
  matchId: ID,
  reviewedAt: '2026-09-09T20:00:00.000Z',
  reviewVersion: 3,
  tier: 'timeline',
  trigger: 'manual',
  models: { team: 'x', players: 'x' },
  compId: null,
  compName: 'Front to back',
  team: {
    headline: 'Bled 35 kills while farming even',
    summary: 'The team matched on CS but gave up the fights. Bot fed first and the map followed. Grubs went well.',
    workOn: [point('Jinx died three times before ten; either play safer trades before towers fall or ask for jungle pressure earlier.', 'fights', 9), point('Trade the third grub for dragon tempo.', 'objectives')],
    keepDoing: [point('Farm held up across the map, so keep the wave states clean.', 'lanes')],
    compVerdict: 'off plan',
    compWhy: 'The comp wanted a slow game and the fights came early.'
  },
  players: [
    { name: 'Rhu', seat: 'ADC', champion: 'Jinx', strength: point('Farmed 312.'), workOn: point('Died early, so hold the wave under tower.'), more: [point('Ward the river bush.', 'vision')] },
    { name: 'Go10x', seat: 'Jungle', champion: 'Trundle', strength: point('Grubs went 4-0.'), workOn: point('Path bot after the first clear.') },
    { name: 'Nia', seat: 'Support', champion: 'Leona', strength: point('Vision score 61.'), workOn: point('Engage only with Jinx in range.') }
  ],
  usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0, tookMs: 0 }
} as unknown as GameReview;

/** A timeline with one death in the ledger, so a film built on it has a tape and a map. */
const timeline = {
  matchId: ID,
  timelineVersion: 2,
  builtAt: '2026-09-09T06:30:00.000Z',
  ourSide: 'blue',
  durationSec: 34 * 60,
  frameSec: 60,
  goldDiff: Array.from({ length: 35 }, (_, m) => -m * 250),
  curve: { leadAt: {}, biggestLead: { gold: 0, minute: 0 }, biggestDeficit: { gold: -8500, minute: 34 } },
  lanes: [],
  firsts: {},
  objectives: [],
  plates: { ours: { top: 0, mid: 0, bot: 0 }, theirs: { top: 0, mid: 0, bot: 0 } },
  deaths: [{ sec: 252, minute: 4, seat: 'ADC', zone: 'bot', theirSide: false, killers: 2, executed: false, warded: false }],
  theirDeaths: [],
  vision: [],
  spend: [],
  facts: {
    factsVersion: 2,
    tier: 'timeline',
    result: 'loss',
    durationMin: 34,
    curve: { shape: 'trailed throughout' },
    lanes: [],
    firsts: {},
    objectives: [],
    deathClusters: [],
    soloDeaths: [],
    vision: [],
    spend: [],
    ledger: [{ minute: 4, seat: 'ADC', zone: 'bot', how: 'gank', could: ['ward'], line: 'Minute 4: Jinx to a gank in bot lane with no ward nearby.' }],
    ledgerSummary: { deaths: 1, ganks: 1, dark: 1, inReach: 0, alone: 0 },
    lines: []
  },
  bytes: 0
} as unknown as MatchTimeline;

function text(root: HTMLElement, selector: string): string {
  return (root.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function click(root: HTMLElement, selector: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  el.click();
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  // Two turns: one for the timeline read to resolve, one for the effects it wakes.
  await Promise.resolve();
  await Promise.resolve();
  harness.detectChanges();
}

async function open(url: string): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, FilmComponent);
  await settle(harness);
  return { harness, root: harness.routeNativeElement as HTMLElement };
}

/** A navigation the page started (Back, Escape twice) runs through the router's own tasks: give it a turn of the clock, then read the url. */
async function landed(harness: RouterTestingHarness): Promise<string> {
  await new Promise((r) => setTimeout(r, 0));
  await harness.fixture.whenStable();
  harness.detectChanges();
  return TestBed.inject(Router).url;
}

function key(name: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: name }));
}

// The page renders under TestBed, which needs the DOM that only the Angular
// runner (ng test, jsdom) provides. Bare vitest has no window, so the spec
// steps aside there instead of failing on the first localStorage call.
describe.skipIf(typeof localStorage === 'undefined')('FilmComponent', () => {
  let data: TeamDataService;
  let prefs: UserPrefsService;

  beforeEach(() => {
    localStorage.clear();
    // Motion off, as the film's own pill would set it: the figures stand at their value instead of
    // counting up over frames jsdom does not draw, and a chapter changes without its fade.
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(ROUTES)] });
    data = TestBed.inject(TeamDataService);
    prefs = TestBed.inject(UserPrefsService);
    data.gameReviews.set([review]);
    data.compAnalysis.set({ games: [game] } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says so when there is no review, and the way to Games is a pill', async () => {
    // Local mode is an editor; with edit mode on the page offers the review, and every action on the film is a button, never a link.
    TestBed.inject(AuthService).editMode.set(true);
    const { harness, root } = await open('/film/none');
    expect(text(root, '.film-empty p')).toBe('No review for this game yet.');
    expect(root.querySelector('.film-dots')).toBeNull();
    const go = root.querySelector<HTMLElement>('.film-empty .view-btn')!;
    expect(go.tagName).toBe('BUTTON');
    expect(root.querySelector('.film-empty a')).toBeNull();
    go.click();
    expect(await landed(harness)).toBe('/games?match=none&tab=games');
  });

  it('Back is a pill in the film bar that returns to the game on Games', async () => {
    const { harness, root } = await open(`/film/${ID}`);
    const back = root.querySelector<HTMLElement>('.film-bar-back')!;
    expect(back.tagName).toBe('BUTTON');
    expect(back.getAttribute('type')).toBe('button');
    expect(text(root, '.film-bar-back')).toBe('arrow_back Back');
    expect(root.querySelector('.film-bar a')).toBeNull();
    back.click();
    expect(await landed(harness)).toBe(`/games?match=${ID}&tab=games`);
  });

  it('Escape once folds what is open and stays; a second within two seconds goes Back', async () => {
    const { harness, root } = await open(`/film/${ID}`);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    key('Escape');
    expect(await landed(harness)).toBe(`/film/${ID}?c=title`);
    expect(root.querySelector('.film-stage')).not.toBeNull();
    // Too late: two seconds and a tick on, the second press is a first press again.
    now.mockReturnValue(1_002_001);
    key('Escape');
    expect(await landed(harness)).toBe(`/film/${ID}?c=title`);
    // In time: it leaves.
    now.mockReturnValue(1_003_000);
    key('Escape');
    expect(await landed(harness)).toBe(`/games?match=${ID}&tab=games`);
  });

  it('Escape, Escape out of full screen closes the drawer and the full screen and stays on the film; only two presses with nothing to close go Back', async () => {
    // 10 Sep 2026, second fix pass: the chapter reports a press that closed something (`escaped`), so the page's two-second rule never counts it.
    const known = signal<ReadonlyMap<string, MatchTimeline | null>>(new Map([[ID, timeline]]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(ROUTES), { provide: MatchTimelineService, useValue: { known, load: async () => null } }] });
    data = TestBed.inject(TeamDataService);
    data.gameReviews.set([review]);
    data.compAnalysis.set({ games: [game] } as never);
    const { harness, root } = await open(`/film/${ID}?c=map`);
    expect(text(root, '.film-kicker')).toContain('The map');
    const fullBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-legend .view-btn')).find((b) => (b.textContent ?? '').includes('Full screen'));
    if (!fullBtn) throw new Error('no Full screen pill on the map');
    fullBtn.click();
    harness.detectChanges();
    expect(root.querySelector('.film-map.is-full')).not.toBeNull();
    expect(root.querySelector('.film-map.is-drawer-closed')).toBeNull();

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    key('Escape');
    expect(await landed(harness)).toBe(`/film/${ID}?c=map`);
    expect(root.querySelector('.film-map.is-full.is-drawer-closed')).not.toBeNull();
    // Half a second on, the natural second press: the full screen goes, the film stays.
    now.mockReturnValue(1_000_500);
    key('Escape');
    expect(await landed(harness)).toBe(`/film/${ID}?c=map`);
    expect(root.querySelector('.film-map.is-full')).toBeNull();
    expect(root.querySelector('.film-stage')).not.toBeNull();
    // Nothing left to close: the next press arms the window, and the one after leaves.
    now.mockReturnValue(1_001_000);
    key('Escape');
    expect(await landed(harness)).toBe(`/film/${ID}?c=map`);
    now.mockReturnValue(1_001_500);
    key('Escape');
    expect(await landed(harness)).toBe(`/games?match=${ID}&tab=games`);
  });

  it('Work on this second on the map opens the tape with the position lab on the death\'s second, and Escape closes the lab first (Part C, 10 Sep 2026)', async () => {
    // A version 3 timeline: the positions once a minute (Riot units) and one ward of ours, so the tape has frames and the map offers the lab.
    const v3 = {
      ...timeline,
      timelineVersion: 3,
      positions: {
        minutes: [0, 34],
        ours: { Jungle: [1000, 1000, 9000, 9000], ADC: [1200, 800, 12000, 3000], Support: [1300, 900, 12200, 3100] },
        theirs: { Top: [13800, 13800, 3000, 12000], Jungle: [13000, 13000, 8000, 8000] }
      },
      wards: [{ sec: 120, seat: 'Support', type: 'control', x: 9000, y: 4000 }]
    } as unknown as MatchTimeline;
    const known = signal<ReadonlyMap<string, MatchTimeline | null>>(new Map([[ID, v3]]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(ROUTES), { provide: MatchTimelineService, useValue: { known, load: async () => null } }] });
    data = TestBed.inject(TeamDataService);
    data.gameReviews.set([review]);
    data.compAnalysis.set({ games: [game] } as never);
    const { harness, root } = await open(`/film/${ID}?c=map`);
    expect(text(root, '.film-kicker')).toContain('The map');
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-death-actions .view-btn')).find((b) => (b.textContent ?? '').includes('Work on this second'));
    if (!btn) throw new Error('no Work on this second pill on the map');
    btn.click();
    await settle(harness);
    // The tape is on stage with the lab open on 4:12, the death's own second, standing.
    expect(text(root, '.film-chapter.is-current .film-kicker')).toContain('The tape');
    expect(root.querySelector('.film-chapter.is-current .film-lab-overlay .lab-square')?.getAttribute('aria-label')).toBe('Position lab at 4:12');
    expect(text(root, '.film-scrub-clock')).toBe('4:12');
    expect(root.querySelectorAll('.film-lab-overlay .lab-death')).toHaveLength(1);
    // Their tokens in the lab carry a champion in a seat at most, never a name.
    for (const tile of Array.from(root.querySelectorAll('.film-lab-overlay .lab-token.is-them .lab-tile'))) expect(tile.getAttribute('aria-label')?.startsWith('Their ')).toBe(true);
    // Escape closes the lab and stays; the press was the lab's, so the next one arms the window rather than leaving.
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    key('Escape');
    expect(await landed(harness)).toBe(`/film/${ID}?c=tape`);
    expect(root.querySelector('.film-lab-overlay')).toBeNull();
    now.mockReturnValue(1_000_500);
    key('Escape');
    expect(await landed(harness)).toBe(`/film/${ID}?c=tape`);
    now.mockReturnValue(1_001_000);
    key('Escape');
    expect(await landed(harness)).toBe(`/games?match=${ID}&tab=games`);
  });

  it('opens on the title card, takes the call, lands the headline and remembers the call', async () => {
    const { harness, root } = await open(`/film/${ID}`);
    // Title, the board (no timeline in local mode), the one thing, the seat, the card.
    expect(root.querySelectorAll('.film-dot')).toHaveLength(5);
    expect(text(root, '.film-call-q')).toBe('What decided this game?');
    expect(root.querySelectorAll('.film-chip')).toHaveLength(4);
    expect(root.querySelector('.film-headline')).toBeNull();

    click(root, '.film-chip');
    harness.detectChanges();
    expect(root.querySelectorAll('.film-word')).toHaveLength(6);
    expect(text(root, '.film-headline')).toBe('Bled 35 kills while farming even');
    expect(text(root, '.film-stamp')).toBe('Loss');
    expect(root.querySelector('.film-result')).toBeNull();
    expect(text(root, '.film-lower-third')).toContain('Kills 14–35');
    expect(root.querySelector('.film-chip.is-right')).not.toBeNull();
    expect(prefs.filmProgress(ID)?.calls?.['title']).toBe(0);
  });

  it('walks the chapters: the commitment, the seat, and the card that finishes the film', async () => {
    const { harness, root } = await open(`/film/${ID}`);

    click(root, '.film-frame-nav .view-btn.active');
    harness.detectChanges();
    expect(text(root, '.film-kicker')).toContain('The board');
    // The counts stay hidden until the call: the chips read "?" and there are no bars.
    expect(text(root, '.film-call-q')).toBe('Which count was furthest apart?');
    expect(text(root, '.film-board-chip b')).toBe('?');
    expect(root.querySelector('.film-board-bars')).toBeNull();
    click(root, '.film-chip');
    harness.detectChanges();
    expect(root.querySelector('.film-chip.is-right')).not.toBeNull();
    expect(root.querySelectorAll('.film-board-bar')).toHaveLength(1);
    expect(text(root, '.film-board-bar.is-widest .film-board-bar-label')).toContain('Kills');
    expect(text(root, '.film-board-note')).toBe('A replay carries totals only.');
    expect(prefs.filmProgress(ID)?.calls?.['board']).toBe(0);
    click(root, '.film-frame-nav .view-btn.active');
    harness.detectChanges();
    expect(text(root, '.film-kicker')).toContain('The one thing');
    expect(text(root, '.film-point-text')).toContain('Jinx died three times before ten');
    expect(root.querySelectorAll('.film-commit-card')).toHaveLength(2);
    click(root, '.film-commit-card');
    harness.detectChanges();
    // Local mode is an editor: the pick lands on the team's document, with initials.
    expect(data.commitmentFor(ID)?.by).toEqual({ unknown: 'a' });
    expect(root.querySelector('.film-commit-card.is-mine.is-team')).not.toBeNull();
    expect(text(root, '.film-commit-card .film-initial')).toBe('UN');
    expect(root.querySelectorAll('.film-rest-card')).toHaveLength(2);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    harness.detectChanges();
    expect(text(root, '.film-kicker')).toContain('Your seat');
    expect(root.querySelectorAll('.film-seat-tab')).toHaveLength(3);
    expect(text(root, '.film-seat-ask')).toContain('Which seat is yours?');
    // The figures belong to the seat on show: Trundle's line, then Jinx's after the switch, never a mix of the two.
    expect(text(root, '.film-seat-stats')).toBe('3/1/6 · 223 CS · 64% KP');
    click(root, '.film-seat-tab:nth-child(2)');
    harness.detectChanges();
    expect(text(root, '.film-seat-who small')).toBe('ADC · Jinx');
    expect(text(root, '.film-seat-stats')).toBe('8/3/2 · 312 CS · 71% KP');
    click(root, '.film-seat-tab:nth-child(1)');
    harness.detectChanges();
    expect(text(root, '.film-seat-stats')).toBe('3/1/6 · 223 CS · 64% KP');
    click(root, '.film-flip-face.is-front');
    harness.detectChanges();
    expect(root.querySelector('.film-flip.is-flipped')).not.toBeNull();
    click(root, '.film-seat-under .view-btn');
    expect(prefs.filmProgress(ID)?.calls?.['seat:Jungle']).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    harness.detectChanges();
    expect(text(root, '.film-kicker')).toContain('The card');
    expect(text(root, '.film-card-headline')).toBe('Bled 35 kills while farming even');
    expect(text(root, '.film-card-block.is-warn')).toContain('Watch for it next game');
    expect(root.querySelectorAll('.film-card-ask')).toHaveLength(3);
    const done = prefs.filmProgress(ID);
    expect(done?.done).toBeTruthy();
    expect(done?.asked).toBe(0);
    expect(done?.nextAskAt).toBeTruthy();
    expect(done?.tally).toBeUndefined();

    const box = root.querySelector<HTMLInputElement>('.film-card-ask-again input')!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    harness.detectChanges();
    expect(prefs.filmProgress(ID)?.nextAskAt).toBeUndefined();
    expect(prefs.filmProgress(ID)?.done).toBeTruthy();
  });

  it('adds The draft, again after the one thing when the review carries a draft verdict', async () => {
    const v5 = {
      ...review,
      reviewVersion: 5,
      team: { ...review.team, draft: { verdict: 'The comp wanted a slow game and the fights came early.', swaps: [{ seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Nautilus peels Jinx through the dive and still starts a fight.', gains: ['peel', 'engage'] }] } }
    } as unknown as GameReview;
    data.gameReviews.set([v5]);
    const { root } = await open(`/film/${ID}?c=draft`);
    // Title, the board, the one thing, the draft, the seat, the card.
    expect(root.querySelectorAll('.film-dot')).toHaveLength(6);
    expect(root.querySelector('.film-dot.active')?.getAttribute('aria-label')).toBe('The draft, again');
    expect(text(root, '.film-kicker')).toContain('The draft, again');
    expect(text(root, '.film-draft-verdict')).toBe('The comp wanted a slow game and the fights came early.');
    expect(root.querySelectorAll('.film-draft-swap')).toHaveLength(1);
    expect(text(root, '.film-draft-swap')).toContain('Nautilus');
  });

  it('waits for the timeline before landing a ?c link, since the tape and the map shift the chapters when it arrives', async () => {
    const v5 = {
      ...review,
      reviewVersion: 5,
      team: { ...review.team, draft: { verdict: 'The comp wanted a slow game and the fights came early.', swaps: [{ seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Peel for Jinx.', gains: ['peel'] }] } }
    } as unknown as GameReview;
    // The timeline read is the page's to wait on: nothing known while it is in flight, then `timeline` (one death in the ledger), so the film has a tape and a map.
    const known = signal<ReadonlyMap<string, MatchTimeline | null>>(new Map());
    const timelines = { known, load: async () => null };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(ROUTES), { provide: MatchTimelineService, useValue: timelines }] });
    data = TestBed.inject(TeamDataService);
    data.gameReviews.set([v5]);
    data.compAnalysis.set({ games: [game] } as never);

    const { harness, root } = await open(`/film/${ID}?c=draft`);
    // In flight: the title card stands and nothing has been placed; the draft is in the list already, but not where it will end up.
    expect(root.querySelector('.film-dot.active')?.getAttribute('aria-label')).toBe('The game');
    expect(root.querySelectorAll('.film-dot')).toHaveLength(6);

    known.set(new Map([[ID, timeline]]));
    await settle(harness);
    // Landed: the tape and the map sit before The one thing, the draft is fifth, and that is where the film opens.
    expect(root.querySelectorAll('.film-dot')).toHaveLength(7);
    expect(root.querySelector('.film-dot.active')?.getAttribute('aria-label')).toBe('The draft, again');
    expect(text(root, '.film-kicker')).toContain('The draft, again');
    expect(text(root, '.film-draft-verdict')).toBe('The comp wanted a slow game and the fights came early.');
  });

  it('opens on the chapter ?c names, and a shared card link writes no progress', async () => {
    const { root } = await open(`/film/${ID}?c=card`);
    expect(root.querySelector('.film-card')).not.toBeNull();
    expect(root.querySelector('.film-dot.active')?.getAttribute('aria-label')).toBe('The card');
    expect(prefs.filmProgress(ID)).toBeUndefined();
  });
});
