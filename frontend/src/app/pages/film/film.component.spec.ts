import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { AnalysisGame, GameReview } from '../../models/team.models';
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

const point = (text: string, theme?: string, minute: number | null = null) => ({ text, evidence: 'kills 14-35 · 312 CS', minute, theme });

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
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'film/:matchId', component: FilmComponent }])] });
    data = TestBed.inject(TeamDataService);
    prefs = TestBed.inject(UserPrefsService);
    data.gameReviews.set([review]);
    data.compAnalysis.set({ games: [game] } as never);
  });

  it('says so when there is no review', async () => {
    const { root } = await open('/film/none');
    expect(text(root, '.film-empty p')).toBe('No review for this game yet.');
    expect(root.querySelector('.film-dots')).toBeNull();
  });

  it('opens on the title card, takes the call, lands the headline and remembers the call', async () => {
    const { harness, root } = await open(`/film/${ID}`);
    expect(root.querySelectorAll('.film-dot')).toHaveLength(4);
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

  it('opens on the chapter ?c names, and a shared card link writes no progress', async () => {
    const { root } = await open(`/film/${ID}?c=card`);
    expect(root.querySelector('.film-card')).not.toBeNull();
    expect(root.querySelector('.film-dot.active')?.getAttribute('aria-label')).toBe('The card');
    expect(prefs.filmProgress(ID)).toBeUndefined();
  });
});
