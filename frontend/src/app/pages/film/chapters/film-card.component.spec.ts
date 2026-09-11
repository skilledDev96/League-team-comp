import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmModel } from '../../../core/film-model';
import { styleFor } from '../../../core/film-style';
import { INFLUENCE_NO_TIMELINE, INFLUENCE_NOTHING, INFLUENCE_TIP } from '../../../core/influence';
import { AnalysisGame, GameReview, MatchTimeline } from '../../../models/team.models';
import { devTimelineKey, MatchTimelineService } from '../../../services/match-timeline.service';
import { ToastService } from '../../../services/toast.service';
import { TooltipDirective } from '../../../shared/tooltip.directive';
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

/** The analysed game behind the review: Jinx carried the line, Wukong was on the herald fight that swung it. */
const game = {
  matchId: ID,
  compId: null,
  compName: null,
  win: false,
  queue: 'Flex',
  date: 0,
  kills: { ours: 20, theirs: 35 },
  players: [
    { name: 'Bom', position: 'TOP', champion: 'Aatrox', kills: 4, deaths: 5, assists: 3, cs: 200, damage: 24000, killParticipation: 0.5 },
    { name: 'Go10x', position: 'JUNGLE', champion: 'MonkeyKing', kills: 5, deaths: 4, assists: 9, cs: 150, damage: 22000, killParticipation: 0.7 },
    { name: 'Kez', position: 'MIDDLE', champion: 'Ahri', kills: 6, deaths: 3, assists: 6, cs: 250, damage: 32000, killParticipation: 0.6 },
    { name: 'Rhu', position: 'BOTTOM', champion: 'Jinx', kills: 9, deaths: 2, assists: 5, cs: 312, damage: 52500, killParticipation: 0.7 },
    { name: 'Sen', position: 'UTILITY', champion: 'Leona', kills: 0, deaths: 6, assists: 11, cs: 40, damage: 8000, killParticipation: 0.55 }
  ]
} as unknown as AnalysisGame;

/** Level to eleven, a thousand up by twelve, four thousand more the minute after the herald at twenty. */
const GOLD = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 5100, 5100, 5100, 5100];

const timeline = {
  matchId: ID,
  timelineVersion: 4,
  builtAt: '2026-09-10T20:00:00.000Z',
  ourSide: 'blue',
  durationSec: 1470,
  frameSec: 60,
  goldDiff: GOLD,
  theirDeaths: [{ sec: 1200, minute: 20, zone: 'river', ourInvolved: ['Jungle'] }],
  deaths: [{ sec: 780, minute: 13, seat: 'Jungle', zone: 'mid', theirSide: false, killers: 2, executed: false, warded: false }],
  objectives: [{ minute: 20, type: 'herald', side: 'us', ourInvolved: [], ourNear: [] }],
  lanes: [],
  firsts: {},
  plates: {},
  vision: [],
  spend: [],
  curve: { leadAt: {}, biggestLead: { gold: 0, minute: 0 }, biggestDeficit: { gold: 0, minute: 0 } },
  bytes: 0
} as unknown as MatchTimeline;

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

  function mount(m: FilmModel = model, r: GameReview = review, analysed?: AnalysisGame) {
    const fixture = TestBed.createComponent(FilmCardComponent);
    fixture.componentRef.setInput('model', m);
    fixture.componentRef.setInput('review', r);
    fixture.componentRef.setInput('ledger', { deaths: 3, ganks: 1, dark: 2, inReach: 0, alone: 0 });
    if (analysed) fixture.componentRef.setInput('game', analysed);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  /** The tip on one of the card's marks, read off the directive: the popover itself needs a browser. */
  function tipOf(fixture: ReturnType<typeof mount>['fixture'], selector: string): string {
    return fixture.debugElement.query(By.css(selector)).injector.get(TooltipDirective).appTip();
  }

  /** The page reads the timeline into the service before the card comes up; the dev override stands in for the document. */
  async function withTimeline(): Promise<void> {
    localStorage.setItem(devTimelineKey(ID), JSON.stringify(timeline));
    await TestBed.inject(MatchTimelineService).load(ID);
  }

  it('shows the swaps to try with the champion we played said the display way', () => {
    const { root } = mount();
    // The last span is the sentence (the first is the arrow's Material ligature); the gains sit in a <small> the stylesheet spaces off.
    const rows = Array.from(root.querySelectorAll('.film-card-draft-row span:last-child')).map((span) => {
      const gains = text(span.querySelector('small'));
      return { who: text(span).replace(gains, '').trim(), gains };
    });
    expect(rows).toEqual([
      { who: 'Nautilus for Leona', gains: '· for peel and engage' },
      { who: 'Sejuani for Wukong', gains: '' }
    ]);
    expect(text(root.querySelector('.film-card-draft'))).not.toContain('MonkeyKing');
  });

  it('Back to the game is a pill, never a link, and goes to the game\'s row on Games', () => {
    // 10 Sep 2026, second fix pass: it was a routerLink styled as a pill, the one link left on the film.
    const { root } = mount();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(root.querySelector('.film-card-actions a')).toBeNull();
    const back = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-card-actions .view-btn')).find((b) => text(b).includes('Back to the game'))!;
    expect(back.tagName).toBe('BUTTON');
    expect(back.getAttribute('type')).toBe('button');
    back.click();
    expect(navigate).toHaveBeenCalledWith(['/games'], { queryParams: { match: model.matchId, tab: 'games' } });
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

  it('names the swap\'s other options after the champion to try, and copies them with what the comp lacked (review version 6)', async () => {
    const draft = model.draft!;
    const v6 = { ...model, draft: { ...draft, swaps: [{ ...draft.swaps[0], alternatives: ['Braum', 'Alistar'] }, draft.swaps[1]] } } as FilmModel;
    const v6review = {
      ...review,
      reviewVersion: 6,
      team: {
        ...review.team,
        draft: {
          ...review.team.draft!,
          swaps: [{ ...review.team.draft!.swaps[0], alternatives: ['Braum', 'Alistar'] }, review.team.draft!.swaps[1]],
          lacked: [{ gain: 'peel', why: 'Jinx had no one between her and the dive.' }]
        }
      }
    } as GameReview;
    const { fixture, root } = mount(v6, v6review);
    const rows = Array.from(root.querySelectorAll('.film-card-draft-row span:last-child')).map((span) => {
      const gains = text(span.querySelector('small'));
      return { who: text(span).replace(gains, '').trim(), gains };
    });
    expect(rows).toEqual([
      { who: 'Nautilus, or Braum, or Alistar for Leona', gains: '· for peel and engage' },
      { who: 'Sejuani for Wukong', gains: '' }
    ]);
    expect(Array.from(root.querySelectorAll('.film-card-draft-alt')).map(text)).toEqual([', or Braum, or Alistar']);
    // The copy carries the same options in brackets, and the gaps as one Lacked line.
    const copy = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-card-actions .view-btn')).find((b) => text(b).includes('Copy for Discord'))!;
    copy.click();
    await fixture.whenStable();
    const lines = written[0].split('\n');
    expect(lines).toContain('-# Draft: Nautilus (or Braum, or Alistar) for Leona (Peel, Engage): Nautilus peels Jinx through the dive.');
    expect(lines).toContain('-# Draft: Sejuani for Wukong: A frontline that starts the fight.');
    expect(lines).toContain('-# Lacked: peel (Jinx had no one between her and the dive)');
  });

  // ---- Who carried it, and who swung it (11 Sep 2026) ----------------------

  it('shows who carried the game above the asks, with the terms behind it in the tip and on the card', async () => {
    await withTimeline();
    const { fixture, root } = mount(model, review, game);
    const marks = root.querySelector('.film-card-marks')!;
    expect(marks.parentElement?.classList.contains('is-asks')).toBe(true);
    const chips = Array.from(marks.querySelectorAll('.mvp-chip'));
    expect(chips.map((c) => text(c.querySelector('.mvp-chip-word')))).toEqual(['MVP', 'Swung it most']);
    expect(text(chips[0].querySelector('.mvp-chip-name'))).toBe('Rhu');
    expect(tipOf(fixture, '.mvp-chip.is-mvp')).toBe('MVP: Rhu on Jinx. 52.5k damage, 38% of ours · on 14 of 20 kills · died twice.');
    // The terms are printed, not only hovered (11 Sep 2026, second fix pass): on a phone a tap on the chip closes its own tip.
    const terms = Array.from(root.querySelectorAll('.film-card-mark-terms')).map((t) => text(t));
    expect(terms[0]).toBe('52.5k damage, 38% of ours · on 14 of 20 kills · died twice');
  });

  it('shows who swung it beside the MVP, so the two can disagree', async () => {
    await withTimeline();
    const { fixture, root } = mount(model, review, game);
    // The ADC carried the line; the jungler was on the herald fight the gold turned on, and the champion is said the display way.
    expect(text(root.querySelector('.mvp-chip.is-swing .mvp-chip-name'))).toBe('Go10x');
    expect(tipOf(fixture, '.mvp-chip.is-swing')).toBe(
      `Swung it most: Go10x on Wukong. +4.1k across the fights they were in · the biggest was +4.1k on the herald at 20 min. ${INFLUENCE_TIP}`
    );
    // And the same terms on the card, with what a minute's resolution cannot see under them.
    const swung = root.querySelectorAll('.film-card-mark-terms')[1];
    expect(text(swung)).toContain('+4.1k across the fights they were in · the biggest was +4.1k on the herald at 20 min');
    expect(text(swung.querySelector('.film-card-mark-tip'))).toBe(INFLUENCE_TIP);
    expect(root.querySelector('.film-card-marks-none')).toBeNull();
  });

  it('says the swing needs a timeline rather than showing a game with none at nothing', () => {
    const { root } = mount(model, review, game);
    expect(root.querySelector('.mvp-chip.is-mvp')).not.toBeNull();
    expect(root.querySelector('.mvp-chip.is-swing')).toBeNull();
    expect(text(root.querySelector('.film-card-marks-none'))).toBe(INFLUENCE_NO_TIMELINE);
  });

  it('reads the timeline only for a timeline-tier review, so the answer does not depend on which row was opened first', async () => {
    // The session cache is filled by any game the Games page opens, whatever its review's tier (11 Sep 2026, second fix
    // pass): without the gate the same film said "Swung it most" or "needs the timeline" depending on the way in.
    await withTimeline();
    const endOfGame = { ...review, tier: 'end' } as unknown as GameReview;
    const { root } = mount(model, endOfGame, game);
    expect(root.querySelector('.mvp-chip.is-swing')).toBeNull();
    expect(text(root.querySelector('.film-card-marks-none'))).toBe(INFLUENCE_NO_TIMELINE);
  });

  it('says a timeline that carried no fight is not the same as no timeline at all', async () => {
    // A document trimmed under MAX_BYTES loses their deaths; saying "this game has none" of a timeline the film is
    // reading from would simply be false.
    localStorage.setItem(devTimelineKey(ID), JSON.stringify({ ...timeline, deaths: [], theirDeaths: [] }));
    await TestBed.inject(MatchTimelineService).load(ID);
    const { root } = mount(model, review, game);
    expect(root.querySelector('.mvp-chip.is-swing')).toBeNull();
    expect(text(root.querySelector('.film-card-marks-none'))).toBe(INFLUENCE_NOTHING);
  });

  it('draws no marks at all for a review with no analysed game beside it', () => {
    const { root } = mount();
    expect(root.querySelector('.film-card-marks')).toBeNull();
    // The asks are still there: the marks are a block inside their column, not a condition on it.
    expect(root.querySelectorAll('.film-card-ask')).toHaveLength(2);
  });
});
