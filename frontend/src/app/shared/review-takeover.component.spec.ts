import { WritableSignal } from '@angular/core';
import { ComponentFixture, DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { AnalysisGame, GameReview, MatchTimeline } from '../models/team.models';
import { GameReviewService } from '../services/game-review.service';
import { MatchTimelineService } from '../services/match-timeline.service';
import { ReviewTakeoverService } from '../services/review-takeover.service';
import { TeamDataService } from '../services/team-data.service';
import { ToastService } from '../services/toast.service';
import { UserPrefsService } from '../services/user-prefs.service';
import { ReviewTakeoverComponent } from './review-takeover.component';

// Local mode, the way the film spec does it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const ID = 'EUW1_7000000002';

const game = {
  matchId: ID,
  date: 1757400000000,
  queue: 'Flex',
  win: true,
  durationSec: 30 * 60,
  kills: { ours: 21, theirs: 9 },
  players: [
    { name: 'Rhu#BOM', position: 'BOTTOM', champion: 'Jinx', kills: 8, deaths: 1, assists: 2, cs: 312, damage: 1 },
    { name: 'Go10x#EUW', position: 'JUNGLE', champion: 'Trundle', kills: 3, deaths: 1, assists: 6, cs: 223, damage: 1 },
    { name: 'Nia#BOM', position: 'UTILITY', champion: 'Leona', kills: 1, deaths: 2, assists: 9, cs: 30, damage: 1 }
  ]
} as unknown as AnalysisGame;

const point = (text: string) => ({ text, evidence: '', minute: null });

const reviewAt = (reviewedAt: string): GameReview =>
  ({
    matchId: ID,
    reviewedAt,
    reviewVersion: 3,
    tier: 'timeline',
    trigger: 'manual',
    models: { team: 'x', players: 'x' },
    compId: null,
    compName: null,
    team: { headline: 'Bot won it before ten', summary: 'Bot won it before ten. The rest followed.', workOn: [point('Path top once.')], keepDoing: [], compVerdict: 'as drafted', compWhy: '' },
    players: [{ name: 'Rhu', seat: 'ADC', champion: 'Jinx', strength: point('Farmed.'), workOn: point('Hold the wave.') }],
    usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0, tookMs: 0 }
  }) as unknown as GameReview;

const timeline = {
  matchId: ID,
  timelineVersion: 2,
  builtAt: '2026-09-09T06:30:00.000Z',
  ourSide: 'blue',
  durationSec: 30 * 60,
  frameSec: 60,
  goldDiff: [],
  curve: { leadAt: {}, biggestLead: { gold: 3000, minute: 20 }, biggestDeficit: { gold: 0, minute: 0 } },
  lanes: [{ seat: 'ADC', champion: 'Jinx', theirChampion: 'Caitlyn' }],
  firsts: {},
  objectives: [],
  plates: { ours: { top: 0, mid: 0, bot: 0 }, theirs: { top: 0, mid: 0, bot: 0 } },
  deaths: [
    { sec: 300, minute: 5, seat: 'ADC', zone: 'bot', theirSide: false, killers: 2, executed: false, warded: false, theirJungleIn: true },
    { sec: 900, minute: 15, seat: 'Support', zone: 'river', theirSide: true, killers: 3, executed: false, warded: true }
  ],
  theirDeaths: [],
  vision: [],
  spend: [],
  facts: { lines: ['Bot lane was 900 up at ten.', 'Nobody died after twenty.'] },
  bytes: 0
} as unknown as MatchTimeline;

/** The element's words, without the icon ligatures. */
const text = (root: Element, selector: string): string => {
  const el = root.querySelector(selector)?.cloneNode(true) as Element | undefined;
  el?.querySelectorAll('.material-symbols-rounded').forEach((i) => i.remove());
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};
const click = (root: Element, selector: string): void => {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing at ${selector}`);
  el.click();
};
const pill = (root: Element, label: string): HTMLButtonElement | undefined => [...root.querySelectorAll<HTMLButtonElement>('button.view-btn')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim().endsWith(label));

// The takeover renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides.
describe.skipIf(typeof localStorage === 'undefined')('ReviewTakeoverComponent', () => {
  let fixture: ComponentFixture<ReviewTakeoverComponent>;
  let root: HTMLElement;
  let svc: ReviewTakeoverService;
  let data: TeamDataService;
  let reviews: GameReviewService;
  let timelines: MatchTimelineService;
  let button: HTMLButtonElement;

  /** A change detection pass, then the deferred stage's chunk, then another. */
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])], deferBlockBehavior: DeferBlockBehavior.Playthrough });
    data = TestBed.inject(TeamDataService);
    svc = TestBed.inject(ReviewTakeoverService);
    reviews = TestBed.inject(GameReviewService);
    timelines = TestBed.inject(MatchTimelineService);
    data.compAnalysis.set({ games: [game] } as never);
    data.gameReviews.set([]);
    vi.spyOn(reviews, 'review').mockImplementation(async () => null);
    button = document.createElement('button');
    button.setAttribute('data-tour', 'games-review-btn');
    document.body.appendChild(button);
    fixture = TestBed.createComponent(ReviewTakeoverComponent);
    root = fixture.nativeElement as HTMLElement;
    await render();
  });

  const openGate = async () => {
    svc.open(ID, null, { x: 10, y: 10, width: 100, height: 30 }, button);
    await render();
  };

  it('renders nothing while closed, and the gate before anything is spent', async () => {
    expect(root.querySelector('.rt-gate')).toBeNull();
    await openGate();
    expect(text(root, '.rt-gate h2')).toBe('Review this game?');
    expect(text(root, '.rt-gate p')).toBe('Two Opus calls over the facts, about a dime.');
    expect(pill(root, 'Roll it')).toBeDefined();
    expect(pill(root, 'Not now')).toBeDefined();
    expect(reviews.review).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe('hidden');

    pill(root, 'Not now')!.click();
    await render();
    expect(svc.phase()).toBe('closed');
    expect(root.querySelector('.rt-gate')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('asks "again" over a game that already has a review, and Escape is Not now', async () => {
    data.gameReviews.set([reviewAt('2026-09-01T10:00:00.000Z')]);
    await openGate();
    expect(text(root, '.rt-gate h2')).toBe('Write the review again?');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await render();
    expect(svc.phase()).toBe('closed');
  });

  it('Roll it fires the review and the totals reel stands in without a timeline', async () => {
    await openGate();
    pill(root, 'Roll it')!.click();
    await render();
    expect(reviews.review).toHaveBeenCalledWith(ID, null);
    expect(svc.phase()).toBe('holding');
    expect(svc.rolling()).toBe(true);
    expect(root.querySelector('.rt-gate')).toBeNull();
    expect(root.querySelector('.rt-stage')).not.toBeNull();
    expect(text(root, '.rt-title')).toBe('READING THE GAME');
    expect(text(root, '.rt-line')).toBe('Fetching the minute-by-minute from Riot, then the coach writes');
    expect(root.querySelectorAll('.rt-champ')).toHaveLength(3);
    expect([...root.querySelectorAll('.rt-champ img')].map((i) => i.getAttribute('alt'))).toEqual(['Trundle', 'Jinx', 'Leona']);
    expect(root.querySelectorAll('.rt-chips .score-chip').length).toBeGreaterThan(1);
    expect(text(root, '.rt-ring-label')).toBe('elapsed, usually 30 to 90 s');
    expect(text(root, '.rt-status')).toBe('Asking what decided it');
    expect(pill(root, 'Minimise')).toBeDefined();
  });

  it('never lands on the review that was already there, and lands on the one written after Roll it', async () => {
    data.gameReviews.set([reviewAt('2026-09-01T10:00:00.000Z')]);
    await openGate();
    pill(root, 'Roll it')!.click();
    await render();
    expect(svc.phase()).toBe('holding');

    data.gameReviews.set([reviewAt(new Date(Date.now() + 1000).toISOString())]);
    await render();
    expect(svc.phase()).toBe('landed');
    expect(svc.rolling()).toBe(false);
    expect(text(root, '.rt-title')).toBe('THE REVIEW IS IN');
    expect(text(root, '.rt-headline')).toBe('Bot won it before ten');
    expect(text(root, '.rt-ring-label')).toBe('elapsed, done');
    expect(pill(root, 'Open the film room')).toBeDefined();
    expect(pill(root, 'Just the summary')).toBeDefined();

    pill(root, 'Just the summary')!.click();
    await render();
    expect(svc.phase()).toBe('closed');
  });

  it('minimised, the landing is a toast with an Open pill and the row is marked ready', async () => {
    const toast = TestBed.inject(ToastService);
    await openGate();
    pill(root, 'Roll it')!.click();
    await render();
    pill(root, 'Minimise')!.click();
    await render();
    expect(svc.phase()).toBe('closed');
    expect(svc.rolling()).toBe(true);
    expect(svc.minimised()).toBe(true);

    data.gameReviews.set([reviewAt(new Date(Date.now() + 1000).toISOString())]);
    await render();
    expect(svc.phase()).toBe('closed');
    expect(svc.ready(ID)).toBe(true);
    const t = toast.toasts()[0];
    expect(t?.title).toBe('The film is ready');
    expect(t?.action?.label).toBe('Open');
    svc.clearReady(ID);
    expect(svc.ready(ID)).toBe(false);
  });

  it('keeps a minimised watch parked when the gate opens on another game, and still lands it as a toast', async () => {
    const toast = TestBed.inject(ToastService);
    const other = 'EUW1_7000000003';
    await openGate();
    pill(root, 'Roll it')!.click();
    await render();
    pill(root, 'Minimise')!.click();
    await render();
    svc.open(other, null, null, button);
    await render();
    expect(svc.phase()).toBe('gate');
    expect(svc.matchId()).toBe(other);
    expect(svc.rolling()).toBe(false);

    data.gameReviews.set([reviewAt(new Date(Date.now() + 1000).toISOString())]);
    await render();
    expect(svc.ready(ID)).toBe(true);
    expect(toast.toasts()[0]?.title).toBe('The film is ready');
    // The new gate is untouched by the other game's landing.
    expect(svc.phase()).toBe('gate');
    expect(svc.matchId()).toBe(other);
  });

  it('a landing during the shrink is announced the way a minimised one is', async () => {
    const toast = TestBed.inject(ToastService);
    await openGate();
    pill(root, 'Roll it')!.click();
    await render();
    data.gameReviews.set([reviewAt(new Date(Date.now() + 1000).toISOString())]);
    await render();
    expect(svc.phase()).toBe('landed');
    // The shrink ends after the landing: Minimise closes it, and the row is told.
    svc.minimise();
    await render();
    expect(svc.phase()).toBe('closed');
    expect(svc.ready(ID)).toBe(true);
    expect(toast.toasts()[0]?.title).toBe('The film is ready');
  });

  it('shows the failure as a callout with Close, and routes nowhere', async () => {
    await openGate();
    pill(root, 'Roll it')!.click();
    await render();
    reviews.errors.set(new Map([[ID, 'The reviewer declined to write about this game.']]));
    await render();
    expect(svc.phase()).toBe('error');
    expect(text(root, '.rt-callout')).toContain('The reviewer declined to write about this game.');
    expect(pill(root, 'Close')).toBeDefined();
    expect(pill(root, 'Open the film room')).toBeUndefined();
    pill(root, 'Close')!.click();
    await render();
    expect(svc.phase()).toBe('closed');
  });

  it('plays the tape reel off a known timeline, and Lock writes the guess for the tape', async () => {
    (timelines as unknown as { loaded: WritableSignal<ReadonlyMap<string, MatchTimeline | null>> }).loaded.set(new Map([[ID, timeline]]));
    await openGate();
    pill(root, 'Roll it')!.click();
    await render();
    expect(text(root, '.rt-title')).toBe('GENERATING A TIMELINE OF THE GAME');
    expect(root.querySelector('app-rift-map')).not.toBeNull();
    // Motion off: every mark placed at once, the clock at the end, the facts as a list.
    expect(text(root, '.rt-clock')).toBe('30:00');
    expect(root.querySelectorAll('.rift-token.is-ourDeath')).toHaveLength(2);
    expect(text(root, '.rift-map-caption')).toBe('2 deaths of ours so far · 1 with no ward nearby · 1 with their jungler close');
    expect(text(root, '.rift-map-note')).toBe('Approximate, by zone');
    expect(svc.phase()).toBe('holding');
    expect([...root.querySelectorAll('.rt-facts li')].map((li) => li.textContent)).toEqual(['Bot lane was 900 up at ten.', 'Nobody died after twenty.']);

    const range = root.querySelector<HTMLInputElement>('.film-scrub-range');
    expect(range).not.toBeNull();
    expect(root.querySelector('.film-scrub-curve')).toBeNull();
    range!.value = '12';
    range!.dispatchEvent(new Event('input', { bubbles: true }));
    await render();
    click(root, '.film-scrub-lock');
    await render();
    expect(text(root, '.rt-locked')).toBe('You said minute 12. The tape reveals it in the film room.');
    expect(TestBed.inject(UserPrefsService).filmProgress(ID)?.calls?.['turn']).toBe(12);
  });
});
