import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { FilmCommitment, GameReview } from '../models/team.models';
import { TeamDataService } from '../services/team-data.service';
import { GameReviewComponent } from './game-review.component';

// Local mode, the way the film's specs do it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const ID = 'EUW1_7000000005';

const point = (text: string, theme?: string, minute: number | null = null) => ({ text, evidence: 'kills 14-35', minute, theme });

/** The first work-on as the review reads now: the sentence the film's One thing chapter commits on. */
const SENTENCE = 'Jinx died three times before ten; either play safer trades or ask for jungle pressure earlier.';

const review = {
  matchId: ID,
  reviewedAt: '2026-09-09T20:00:00.000Z',
  reviewVersion: 5,
  tier: 'timeline',
  trigger: 'manual',
  models: { team: 'claude-opus-5', players: 'claude-opus-5' },
  compId: null,
  compName: 'Front to back',
  team: {
    headline: 'Bled 35 kills while farming even',
    summary: 'The team matched on CS but gave up the fights.',
    workOn: [{ ...point(SENTENCE, 'fights', 9), options: ['Play safer trades', 'Ask for jungle pressure earlier'] }],
    keepDoing: [point('Farm held up across the map.', 'lanes')],
    compVerdict: 'off plan',
    compWhy: 'The comp wanted a slow game and the fights came early.'
  },
  players: [{ name: 'Rhu', seat: 'ADC', champion: 'Jinx', strength: point('Farmed 312.'), workOn: point('Died early, so hold the wave under tower.'), more: [] }],
  usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0.1, tookMs: 0 }
} as unknown as GameReview;

const committed = (text: string, options: [string, string]): FilmCommitment => ({ matchId: ID, text, options, by: { 'rhu@bom.gg': 'b', 'kez@bom.gg': 'b' } });

function text(el: Element | null): string {
  const copy = el?.cloneNode(true) as Element | undefined;
  copy?.querySelectorAll('.material-symbols-rounded').forEach((i) => i.remove());
  return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The panel renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides.
describe.skipIf(typeof localStorage === 'undefined')('GameReviewComponent', () => {
  const written: string[] = [];
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let data: TeamDataService;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('bom-motion', 'off');
    written.length = 0;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async (t: string) => void written.push(t)) }, configurable: true });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    data = TestBed.inject(TeamDataService);
  });

  afterEach(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  async function mount() {
    const fixture = TestBed.createComponent(GameReviewComponent);
    fixture.componentRef.setInput('review', review);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const copied = async () => {
      root.querySelector<HTMLButtonElement>('.game-review-copy')!.click();
      await fixture.whenStable();
      return written.at(-1) ?? '';
    };
    return { fixture, root, line: () => root.querySelector('.game-review-line-one.is-commit'), copied };
  }

  it('prints no commitment, on the panel or in the chat copy, once a re-review has reworded the sentence it was made on', async () => {
    // 17 Sep 2026: the old picks stay in the team's document while the review's first work-on and its options are new.
    data.filmCommitments.set([committed('Jinx walked into five alone; either reset until all five are up or hold for the Baron timer.', ['Reset until all five are up', 'Hold for the Baron timer'])]);
    const { line, copied } = await mount();
    expect(line()).toBeNull();
    const copy = await copied();
    expect(copy).toContain('## Bled 35 kills while farming even');
    expect(copy).not.toContain('We committed to');
    expect(copy).not.toContain('Hold for the Baron timer');
  });

  it('prints the commitment and its initials while it stands on the sentence the review reads, case and spacing aside', async () => {
    data.filmCommitments.set([committed(`  ${SENTENCE.toUpperCase().replace(/ /g, '  ')}\n`, ['Play safer trades', 'Ask for jungle pressure earlier'])]);
    const { line, copied } = await mount();
    expect(text(line()?.querySelector('b') ?? null)).toBe('We committed to');
    expect(text(line()?.querySelector('b + span') ?? null)).toBe('Ask for jungle pressure earlier(RH, KE)');
    expect(await copied()).toContain('-# We committed to: Ask for jungle pressure earlier');
  });
});