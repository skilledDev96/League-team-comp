import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmModel } from '../../../core/film-model';
import { styleFor } from '../../../core/film-style';
import { GameReview } from '../../../models/team.models';
import { ToastService } from '../../../services/toast.service';
import { FilmCardComponent } from './film-card.component';

// Local mode, the way the film page's spec does it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const ID = 'EUW1_7000000001';

const point = (text: string, theme?: string, minute: number | null = null) => ({ text, evidence: 'kills 14-35', minute, theme });

const review = {
  matchId: ID,
  reviewedAt: '2026-09-09T20:00:00.000Z',
  reviewVersion: 5,
  tier: 'timeline',
  trigger: 'manual',
  models: { team: 'x', players: 'x' },
  compId: null,
  compName: 'Front to back',
  team: {
    headline: 'Bled 35 kills while farming even',
    summary: 'The team matched on CS but gave up the fights.',
    workOn: [point('Jinx died three times before ten; either play safer trades or ask for jungle pressure earlier.', 'fights', 9)],
    keepDoing: [point('Farm held up across the map.', 'lanes')],
    compVerdict: 'off plan',
    compWhy: 'The comp wanted a slow game and the fights came early.',
    draft: {
      verdict: 'The comp wanted a slow game and the fights came early.',
      swaps: [
        { seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Nautilus peels Jinx through the dive.', gains: ['peel', 'engage'] },
        // Riot's id for the champion we played; the card and the copy say it the display way.
        { seat: 'Jungle', out: 'MonkeyKing', in: 'Sejuani', why: 'A frontline that starts the fight.', gains: [] }
      ]
    }
  },
  players: [
    { name: 'Rhu', seat: 'ADC', champion: 'Jinx', strength: point('Farmed 312.'), workOn: point('Died early, so hold the wave under tower.'), more: [] },
    { name: 'Go10x', seat: 'Jungle', champion: 'MonkeyKing', strength: point('Grubs went 4-0.'), workOn: point('Path bot after the first clear.'), more: [] }
  ],
  usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0, tookMs: 0 }
} as unknown as GameReview;

const model = {
  matchId: ID,
  tier: 'timeline',
  seed: 7,
  style: styleFor(7, false),
  chapters: [],
  seats: [],
  title: { headline: 'Bled 35 kills while farming even', win: false, protagonist: { seat: 'ADC', champion: 'Jinx', name: 'Rhu' }, lowerThird: { date: 0, compName: 'Front to back', compVerdict: 'off plan', compWhy: '', tier: 'timeline' } },
  oneThing: { point: review.team.workOn[0], rest: [] },
  card: {
    headline: 'Bled 35 kills while farming even',
    scoreline: [],
    oneThing: 'Play safer trades or ask for jungle pressure earlier.',
    asks: [
      { name: 'Rhu', seat: 'ADC', champion: 'Jinx', ask: 'Hold the wave under tower.' },
      { name: 'Go10x', seat: 'Jungle', champion: 'MonkeyKing', ask: 'Path bot after the first clear.' }
    ],
    keepDoing: 'Farm held up across the map.'
  },
  draft: {
    verdict: 'The comp wanted a slow game and the fights came early.',
    ours: [],
    theirs: [],
    swaps: [
      { seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Nautilus peels Jinx through the dive.', gains: ['peel', 'engage'], glyphs: ['shield', 'fist'] },
      { seat: 'Jungle', out: 'MonkeyKing', in: 'Sejuani', why: 'A frontline that starts the fight.', gains: [], glyphs: ['swap'] }
    ],
    compId: null,
    compName: 'Front to back',
    variantName: 'Front to back · Nautilus'
  },
  map: { pins: [], theirs: [], clusters: [], summary: { deaths: 3, ganks: 1, dark: 2, inReach: 0, alone: 0 }, reads: { avoidable: 1, traded: 1, bought: 1, clean: 0 }, opening: '3 deaths: 1 avoidable, 1 traded, 1 bought an objective.', costliest: [], order: 'chronological' }
} as unknown as FilmModel;

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The chapter renders under TestBed, which needs the DOM that only the Angular
// runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('FilmCardComponent', () => {
  const written: string[] = [];
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  beforeEach(() => {
    localStorage.clear();
    // Motion off, as the film's own pill would set it: the figures stand at their value.
    localStorage.setItem('bom-motion', 'off');
    written.length = 0;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async (t: string) => void written.push(t)) }, configurable: true });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  afterEach(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  function mount() {
    const fixture = TestBed.createComponent(FilmCardComponent);
    fixture.componentRef.setInput('model', model);
    fixture.componentRef.setInput('review', review);
    fixture.componentRef.setInput('ledger', { deaths: 3, ganks: 1, dark: 2, inReach: 0, alone: 0 });
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('shows the swaps to try with the champion we played said the display way', () => {
    const { root } = mount();
    // The last span is the sentence (the first is the arrow's Material ligature); the gains sit in a <small> the stylesheet spaces off.
    const rows = Array.from(root.querySelectorAll('.film-card-draft-row span:last-child')).map((span) => {
      const gains = text(span.querySelector('small'));
      return { who: text(span).replace(gains, '').trim(), gains };
    });
    expect(rows).toEqual([
      { who: 'Nautilus for Leona', gains: 'peel and engage' },
      { who: 'Sejuani for Wukong', gains: '' }
    ]);
    expect(text(root.querySelector('.film-card-draft'))).not.toContain('MonkeyKing');
  });

  it('copies what the card shows: the draft to try and the film\'s reads of the deaths, over the ledger\'s counts', async () => {
    const { fixture, root } = mount();
    const copy = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-card-actions .view-btn')).find((b) => text(b).includes('Copy for Discord'))!;
    copy.click();
    await fixture.whenStable();
    expect(written).toHaveLength(1);
    const lines = written[0].split('\n');
    expect(lines[0]).toBe('## Bled 35 kills while farming even');
    // The deaths line is the film's reads, not "2 with no ward nearby".
    expect(lines).toContain('-# 💀 3 deaths: 1 avoidable, 1 traded, 1 bought an objective.');
    expect(written[0]).not.toContain('with no ward nearby');
    // The Draft lines the card itself shows, with the champion we played said the display way.
    expect(lines).toContain('-# Draft: Nautilus for Leona (Peel, Engage): Nautilus peels Jinx through the dive.');
    expect(lines).toContain('-# Draft: Sejuani for Wukong: A frontline that starts the fight.');
    expect(lines.filter((l) => l.startsWith('-# Draft')).join('\n')).not.toContain('MonkeyKing');
    expect(lines.at(-1)).toContain(`/film/${ID}`);
    expect(TestBed.inject(ToastService).toasts()[0]?.title).toBe('Card copied');
  });
});
