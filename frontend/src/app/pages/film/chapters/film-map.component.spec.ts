import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmDeathPin, FilmDeathScene, FilmMap, FilmModel } from '../../../core/film-model';
import { styleFor } from '../../../core/film-style';
import { costLine, FilmMapComponent, k, signedK } from './film-map.component';

// Local mode, the way the film page's spec does it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const scene: FilmDeathScene = { could: [], killers: 2, executed: false, traded: 0, warded: false };

const pins: FilmDeathPin[] = [
  {
    key: 'd:4:ADC', sec: 252, minute: 4, seat: 'ADC', name: 'Rhu', champion: 'Jinx', zone: 'bot', x: 85, y: 84, how: 'gank', could: ['ward', 'call'],
    line: 'Minute 4: Jinx to a gank in bot lane with no ward nearby.',
    read: 'avoidable', readLine: 'Avoidable: two came in and no ward had gone down nearby, and their jungler had been on this side a minute earlier.',
    glyphs: ['ward-off', 'horn'], cost: -1200, scene: { ...scene, could: ['ward', 'call'], alliesNear: 1, ourJungler: { champion: 'Trundle', zone: 'top', far: false }, theirJungler: { champion: 'LeeSin', close: true } }
  },
  {
    key: 'd:20:Support', sec: 1210, minute: 20, seat: 'Support', name: 'Nia', champion: 'Leona', zone: 'river', x: 50, y: 50, how: 'fight', could: [],
    line: 'Minute 20: Leona in a fight.',
    read: 'traded', readLine: 'Traded: one of theirs fell in the same fight.', glyphs: ['swords'], cost: 300, scene: { ...scene, killers: 4, traded: 1 }
  },
  {
    key: 'd:8:Jungle', sec: 470, minute: 8, seat: 'Jungle', name: 'Go10x', champion: 'Trundle', zone: 'river', x: 60, y: 55, how: 'fight', could: [],
    line: 'Minute 8: Trundle in a fight at the dragon.',
    read: 'bought', readLine: 'Bought the dragon: it fell to us within a minute.', glyphs: ['dragon'], scene: { ...scene, killers: 3, objective: { type: 'dragon', ours: true } }
  }
];

const map: FilmMap = {
  pins,
  theirs: [{ x: 40, y: 60, minute: 6 }],
  clusters: [],
  summary: { deaths: 3, ganks: 1, dark: 1, inReach: 0, alone: 0 },
  reads: { avoidable: 1, traded: 1, bought: 1, clean: 0 },
  opening: '3 deaths: 1 avoidable, 1 traded, 1 bought an objective.',
  costliest: ['d:4:ADC'],
  order: 'chronological'
};

function modelWith(m: FilmMap | undefined): FilmModel {
  return {
    matchId: 'EUW1_7000000001',
    tier: 'timeline',
    seed: 7,
    style: styleFor(7, false),
    chapters: [],
    seats: [],
    title: { headline: 'Bled 35 kills', win: false, protagonist: { seat: 'ADC', champion: 'Jinx', name: 'Rhu' }, lowerThird: { date: 0, compName: null, compVerdict: 'off plan', compWhy: '', tier: 'timeline' } },
    map: m
  } as unknown as FilmModel;
}

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function click(root: HTMLElement, selector: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  el.click();
}

/** The pill in the legend whose words include `word` (the table pill's text starts with its icon's ligature). */
function legendPill(root: HTMLElement, word: string): HTMLButtonElement {
  const pill = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-legend .view-btn')).find((b) => text(b).includes(word));
  if (!pill) throw new Error(`no legend pill reads ${word}`);
  return pill;
}

describe('the map card wording', () => {
  it('writes gold as thousands, with a sign for the costliest strip', () => {
    expect(k(1200)).toBe('1.2k');
    expect(k(-1000)).toBe('1k');
    expect(k(400)).toBe('400');
    expect(signedK(-1200)).toBe('-1.2k');
    expect(signedK(400)).toBe('+400');
  });

  it('says a cost only from 300 gold either way', () => {
    expect(costLine(-1200)).toBe('It cost about 1.2k over the next two minutes.');
    expect(costLine(400)).toBe('We came out 400 up over the next two minutes.');
    expect(costLine(-299)).toBe('');
    expect(costLine(undefined)).toBe('');
  });
});

// The chapter renders under TestBed, which needs the DOM that only the Angular
// runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('FilmMapComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    // Motion off: the opening count stands at its value instead of counting over frames jsdom does not draw.
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  function mount(m: FilmMap | undefined) {
    const fixture = TestBed.createComponent(FilmMapComponent);
    fixture.componentRef.setInput('model', modelWith(m));
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('opens on the reads line, a legend of the reads present and the first death read out', () => {
    const { root } = mount(map);
    expect(root.querySelector('.film-map-opening .film-num')?.getAttribute('data-count')).toBe('3');
    expect(text(root.querySelector('.film-map-opening'))).toBe('3 deaths: 1 avoidable, 1 traded, 1 bought an objective.');
    // All, the three reads with a death, As a table; clean has none and gets no pill.
    const pills = Array.from(root.querySelectorAll('.film-legend .view-btn')).map((b) => text(b));
    expect(pills).toEqual(['All 3', 'Avoidable 1', 'Traded 1', 'Bought an objective 1', 'table_rows As a table']);
    expect(root.querySelector('.film-legend .is-read-avoidable .film-glyph')?.getAttribute('data-glyph')).toBe('skull');
    // Nothing asks any more: no call, no chips to pick, no range to lock.
    expect(root.querySelector('.film-call')).toBeNull();
    expect(root.querySelector('.film-chip')).toBeNull();
    expect(root.querySelector('input[type="range"]')).toBeNull();

    const card = root.querySelector('.film-death-card')!;
    expect(card.getAttribute('data-read')).toBe('avoidable');
    expect(text(card.querySelector('.film-death-who b'))).toBe('Rhu');
    expect(text(card.querySelector('.film-death-n'))).toBe('1 / 3');
    expect(text(card.querySelector('.film-read-badge'))).toBe('Avoidable');
    expect(card.querySelector('.film-read-badge.is-read-avoidable .film-glyph')?.getAttribute('data-glyph')).toBe('skull');
    // The scene is drawn for this read, with the ward and their jungler in it.
    const svg = card.querySelector('svg.death-scene')!;
    expect(svg.getAttribute('data-read')).toBe('avoidable');
    expect(svg.getAttribute('aria-label')).toBe(pins[0].readLine);
    expect(svg.querySelector('.death-scene-ward')).not.toBeNull();
    expect(svg.querySelector('.death-scene-their-jungler')).not.toBeNull();
    // The read in a sentence, its cost, the ledger's own line since it says more, and the tags as glyph chips.
    const line = card.querySelector('.film-death-line')!;
    expect(text(line)).toBe(pins[0].readLine);
    expect(line.classList.contains('is-warn')).toBe(true);
    expect(text(card.querySelector('.film-death-cost'))).toBe('It cost about 1.2k over the next two minutes.');
    expect(text(card.querySelector('.film-death-ledger'))).toBe('Minute 4: Jinx to a gank in bot lane with no ward nearby.');
    expect(Array.from(card.querySelectorAll('.film-death-tags .could-chip')).map((c) => text(c))).toEqual(['A ward', 'A call']);
    expect(Array.from(card.querySelectorAll('.film-death-tags .film-glyph')).map((g) => g.getAttribute('data-glyph'))).toEqual(['ward-off', 'horn']);
    // Every pin is on the map with its read from the start; nothing is hollow.
    expect(root.querySelectorAll('.rift-token.is-ourDeath')).toHaveLength(3);
    expect(root.querySelector('.rift-token.is-unread')).toBeNull();
    expect(root.querySelectorAll('.rift-token.is-theirDeath')).toHaveLength(1);
  });

  it('names the deaths that cost most and jumps to one on a tap', () => {
    const { fixture, root } = mount(map);
    expect(text(root.querySelector('.film-costliest-label'))).toBe('The ones that cost most');
    const cards = root.querySelectorAll<HTMLButtonElement>('.film-costliest-card');
    expect(cards).toHaveLength(1);
    expect(text(cards[0].querySelector('.film-costliest-who'))).toBe('Rhu');
    expect(text(cards[0].querySelector('.film-costliest-cost'))).toBe('-1.2k');
    // Walk to the second death, then the strip brings the card back to the first.
    click(root, '.film-death-actions .view-btn.active');
    fixture.detectChanges();
    expect(text(root.querySelector('.film-death-n'))).toBe('2 / 3');
    expect(text(root.querySelector('.film-death-line'))).toBe('Traded: one of theirs fell in the same fight.');
    expect(root.querySelector('.film-death-line')?.classList.contains('is-warn')).toBe(false);
    expect(text(root.querySelector('.film-death-cost'))).toBe('We came out 300 up over the next two minutes.');
    expect(root.querySelector('.film-death-tags')).toBeNull();
    cards[0].click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-death-n'))).toBe('1 / 3');
    expect(root.querySelector('.film-costliest-card.active')).not.toBeNull();
  });

  it('lights one read at a time from the legend, and the same pill again is All', () => {
    const { fixture, root } = mount(map);
    legendPill(root, 'Bought').click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.rift-token.is-ourDeath.is-faded')).toHaveLength(2);
    expect(root.querySelector('.rift-token.is-read-bought')?.classList.contains('is-faded')).toBe(false);
    expect(legendPill(root, 'Bought').getAttribute('aria-pressed')).toBe('true');
    legendPill(root, 'Bought').click();
    fixture.detectChanges();
    expect(root.querySelectorAll('.rift-token.is-faded')).toHaveLength(0);
    expect(legendPill(root, 'All').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the bought read in the win colour and hands Watch it the second', () => {
    const { fixture, root } = mount(map);
    const watched: number[] = [];
    fixture.componentInstance.watch.subscribe((sec) => watched.push(sec));
    click(root, '.film-death-actions .view-btn.active');
    click(root, '.film-death-actions .view-btn.active');
    fixture.detectChanges();
    expect(text(root.querySelector('.film-death-n'))).toBe('3 / 3');
    expect(root.querySelector('.film-death-line')?.classList.contains('is-ok')).toBe(true);
    expect(root.querySelector('.film-death-cost')).toBeNull();
    expect((root.querySelector('.film-death-actions .view-btn.active') as HTMLButtonElement).disabled).toBe(true);
    const watch = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-death-actions .view-btn')).find((b) => text(b).includes('play_circle'))!;
    watch.click();
    expect(watched).toEqual([470]);
  });

  it('puts a Read column in the table, and a row jumps the card to the death', () => {
    const { fixture, root } = mount(map);
    legendPill(root, 'As a table').click();
    fixture.detectChanges();
    const heads = Array.from(root.querySelectorAll('.film-map-table th')).map((h) => text(h));
    expect(heads).toEqual(['Min', 'Who', 'Where', 'How', 'Read', 'Could have been stopped by']);
    const rows = root.querySelectorAll<HTMLTableRowElement>('.film-map-table tbody tr');
    expect(rows).toHaveLength(3);
    expect(text(rows[1].querySelector('.film-read-badge'))).toBe('Traded');
    expect(text(rows[1].querySelectorAll('td')[5])).toBe('Nothing');
    expect(root.querySelector('.film-death-card')).toBeNull();
    rows[2].click();
    fixture.detectChanges();
    expect(root.querySelector('.film-map-table')).toBeNull();
    expect(text(root.querySelector('.film-death-n'))).toBe('3 / 3');
  });

  it('says so with no deaths, and with no ledger', () => {
    const empty = mount({ ...map, pins: [], reads: { avoidable: 0, traded: 0, bought: 0, clean: 0 }, opening: 'No deaths.', costliest: [] });
    expect(text(empty.root.querySelector('.film-map-opening'))).toBe('No deaths.');
    expect(empty.root.querySelector('.film-map-opening .film-num')).toBeNull();
    expect(text(empty.root.querySelector('.film-wait'))).toBe('Nobody died. Keep doing that.');
    const none = mount(undefined);
    expect(text(none.root.querySelector('.film-wait'))).toBe('No death ledger for this game, so there is no map.');
  });
});
