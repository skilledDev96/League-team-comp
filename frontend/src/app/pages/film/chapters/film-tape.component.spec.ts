import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmBeat, FilmDeathPin, FilmModel, FilmTape } from '../../../core/film-model';
import { styleFor } from '../../../core/film-style';
import { dwellMsFor, FilmTapeComponent, neighbourBeat } from './film-tape.component';

// Local mode, the way the film page's spec does it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const beats: FilmBeat[] = [
  { key: 'b:first:240', sec: 240, kind: 'first', title: 'First blood, theirs', text: 'The first kill of the game went their way, around minute 4.', swing: 'them', glyph: 'blood' },
  { key: 'b:moment:480', sec: 480, kind: 'moment', title: 'Our way', text: 'Dragon at 8 with all five nearby.', swing: 'us', glyph: 'dragon', seats: ['Jungle', 'ADC'], champions: ['Trundle', 'Jinx'], consequence: 'Over the next three minutes: +600' },
  { key: 'b:turn:1260', sec: 1260, kind: 'turn', title: 'Where it turned', text: 'Never in front; it broke open around minute 21, down 7.2k', swing: 'them', glyph: 'coin' },
  { key: 'd:24:Jungle', sec: 1473, kind: 'death', title: 'Go10x falls, avoidable', text: 'Avoidable: alone on their side of the map.', swing: 'them', glyph: 'footsteps', seats: ['Jungle'], champions: ['Trundle'] }
];

const tape: FilmTape = {
  durationSec: 1800,
  ourSide: 'blue',
  goldDiff: [0, 100, 200, 100, -200, -600, -900, -1200, -600, -800, -1500, -2200, -3000, -3600, -4200, -4800, -5400, -6000, -6600, -7000, -7200, -7200, -7000, -6800, -6600, -6400, -6200, -6000, -5800, -5600, -5400],
  turn: { minute: 21, why: 'Never in front; it broke open around minute 21, down 7.2k' },
  moments: [{ minute: 8, text: 'Dragon at 8 with all five nearby.', swing: 'us', seats: ['Jungle', 'ADC'] }],
  events: [{ sec: 1473, kind: 'ourDeath', label: 'Go10x (Jungle) died', side: 'us', seat: 'Jungle', champion: 'Trundle', zone: 'theirJungle', x: 70, y: 30, key: 'd:24:Jungle' }],
  beats
};

const pin = {
  key: 'd:24:Jungle', sec: 1473, minute: 24, seat: 'Jungle', name: 'Go10x', champion: 'Trundle', zone: 'theirJungle', x: 70, y: 30, how: 'solo', could: ['position'],
  line: 'Minute 24: Trundle alone on their side.', read: 'avoidable', readLine: 'Avoidable: alone on their side of the map.', glyphs: ['footsteps'],
  scene: { could: ['position'], killers: 1, executed: false, traded: 0, warded: false }
} as FilmDeathPin;

function modelWith(t: FilmTape | undefined): FilmModel {
  return {
    matchId: 'EUW1_7000000001',
    tier: 'timeline',
    seed: 7,
    style: styleFor(7, false),
    chapters: [],
    seats: [
      { seat: 'Jungle', name: 'Go10x', champion: 'Trundle' },
      { seat: 'ADC', name: 'Rhu', champion: 'Jinx' }
    ],
    title: { headline: 'Bled 35 kills', win: false, protagonist: { seat: 'ADC', champion: 'Jinx', name: 'Rhu' }, lowerThird: { date: 0, compName: null, compVerdict: 'off plan', compWhy: '', tier: 'timeline' } },
    tape: t,
    map: t ? { pins: [pin], theirs: [], clusters: [], summary: { deaths: 1, ganks: 0, dark: 0, inReach: 0, alone: 1 }, reads: { avoidable: 1, traded: 0, bought: 0, clean: 0 }, opening: '1 death: 1 avoidable.', costliest: ['d:24:Jungle'], order: 'chronological' } : undefined
  } as unknown as FilmModel;
}

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The pill in the sheet whose words include `word`. */
function pill(root: HTMLElement, word: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-tape-sheet .view-btn')).find((b) => text(b).includes(word));
  if (!found) throw new Error(`no pill reads ${word}`);
  return found;
}

describe('the tape beat maths', () => {
  it('finds the next and the previous beat, never the one under the hand', () => {
    expect(neighbourBeat(beats, 0, 1)?.key).toBe('b:first:240');
    expect(neighbourBeat(beats, 240, 1)?.key).toBe('b:moment:480');
    expect(neighbourBeat(beats, 240, -1)).toBeUndefined();
    expect(neighbourBeat(beats, 1260, -1)?.key).toBe('b:moment:480');
    expect(neighbourBeat(beats, 1473, 1)).toBeUndefined();
    expect(neighbourBeat([], 100, 1)).toBeUndefined();
  });

  it('holds a card between 3.5 and 8 seconds, by its words', () => {
    expect(dwellMsFor('Short.')).toBe(3500);
    expect(dwellMsFor(Array.from({ length: 20 }, () => 'word').join(' '))).toBe(5600);
    expect(dwellMsFor(Array.from({ length: 40 }, () => 'word').join(' '))).toBe(8000);
    expect(dwellMsFor('')).toBe(3500);
  });
});

// The chapter renders under TestBed, which needs the DOM that only the Angular
// runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('FilmTapeComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    // Motion off, as the film's own pill would set it: nothing plays on its own, no dwell, the curve stands whole.
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  function mount(t: FilmTape | undefined, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(FilmTapeComponent);
    fixture.componentRef.setInput('model', modelWith(t));
    fixture.componentRef.setInput('active', true);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('opens revealed on the turn, standing at its minute, with no question anywhere', () => {
    const { root } = mount(tape);
    expect(root.querySelector('.film-tape.is-revealed')).not.toBeNull();
    expect(text(root.querySelector('.film-tape-sheet-kicker'))).toBe('Where it turned');
    expect(text(root.querySelector('.film-tape-sheet-text'))).toBe('Never in front; it broke open around minute 21, down 7.2k');
    // No guess from the takeover: the turn alone, no verdict line in the sheet.
    expect(root.querySelector('.film-tape-sheet .film-tape-sheet-line')).toBeNull();
    expect(root.querySelector('.film-scrub-ask')).toBeNull();
    expect(root.querySelector('.film-scrub-lock')).toBeNull();
    expect(root.querySelectorAll('polyline.film-scrub-curve')).toHaveLength(2);
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('21:00');
    // The rail: one chip per beat, glyph and minute, the turn's lit since the hand stands on it.
    const chips = root.querySelectorAll<HTMLButtonElement>('.film-beats .film-beat-chip');
    expect(chips).toHaveLength(4);
    expect(Array.from(chips).map((c) => text(c))).toEqual(['4', '8', '21', '25']);
    expect(Array.from(chips).map((c) => c.querySelector('.film-glyph')?.getAttribute('data-glyph'))).toEqual(['blood', 'dragon', 'coin', 'footsteps']);
    expect(chips[2].classList.contains('is-current')).toBe(true);
    expect(chips[1].classList.contains('is-current')).toBe(false);
  });

  it('shows the takeover guess against the turn when there is one, once, under the scrubber', () => {
    const close = mount(tape, { guess: 20 });
    expect(text(close.root.querySelector('.film-tape-sheet-kicker'))).toBe('Called it');
    expect(text(close.root.querySelector('.film-scrub-verdict'))).toBe('You said 20, it turned around 21');
    // The sheet does not say it a second time.
    expect(close.root.querySelector('.film-tape-sheet .film-tape-sheet-line')).toBeNull();
    expect(close.root.querySelectorAll('.film-scrub-verdict')).toHaveLength(1);
    const far = mount(tape, { guess: 9 });
    expect(text(far.root.querySelector('.film-tape-sheet-kicker'))).toBe('Where it turned');
    expect(text(far.root.querySelector('.film-scrub-verdict'))).toBe('You said 9, it turned around 21');
  });

  it('opens a Watch it that arrived off stage on its second, standing and playing, with no sweep from the start', () => {
    // Motion on: this is the one case where the curve's draw would run, and it must not.
    localStorage.setItem('bom-motion', 'on');
    const fixture = TestBed.createComponent(FilmTapeComponent);
    fixture.componentRef.setInput('model', modelWith(tape));
    fixture.componentRef.setInput('active', false);
    fixture.detectChanges();
    // The map's Watch it on the death at 24:33: twenty seconds before, while the map is still on stage.
    fixture.componentRef.setInput('seekTo', { sec: 1453, n: 1, play: true });
    fixture.detectChanges();
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('24:13');
    expect(root.querySelector('.film-tape.is-revealed')).not.toBeNull();
    fixture.destroy();
  });

  it('reads a beat from the rail: glyph, minute and swing, title, text, the champions in their seats, the consequence, and no dwell with motion off', () => {
    const { fixture, root } = mount(tape);
    root.querySelectorAll<HTMLButtonElement>('.film-beat-chip')[1].click();
    fixture.detectChanges();
    const card = root.querySelector('.film-beat')!;
    expect(card.getAttribute('data-kind')).toBe('moment');
    expect(card.querySelector('.film-beat-glyph .film-glyph')?.getAttribute('data-glyph')).toBe('dragon');
    expect(text(card.querySelector('.film-beat-kicker'))).toBe('8:00 Our way');
    expect(card.querySelector('.film-beat-kicker')?.classList.contains('is-ok')).toBe(true);
    // A moment's title is its swing, which the kicker has just said; the title line stands only when it says more.
    expect(card.querySelector('.film-beat-title')).toBeNull();
    expect(text(card.querySelector('.film-beat-text'))).toBe('Dragon at 8 with all five nearby.');
    expect(Array.from(card.querySelectorAll('.film-beat-tile')).map((t) => text(t))).toEqual(['Jungle', 'ADC']);
    expect(Array.from(card.querySelectorAll('.film-beat-tile img')).map((i) => i.getAttribute('alt'))).toEqual(['Trundle', 'Jinx']);
    expect(text(card.querySelector('.film-beat-consequence'))).toBe('Over the next three minutes: +600');
    expect(card.querySelector('.film-beat-dwell')).toBeNull();
    expect(root.querySelector('.film-beat-chip.is-current')).toBe(root.querySelectorAll('.film-beat-chip')[1]);
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('8:00');
    // The one pill is the voice's Continue; nothing plays with motion off, and the sheet goes back to the turn.
    const pills = Array.from(card.querySelectorAll('.view-btn')).map((b) => text(b));
    expect(pills).toHaveLength(1);
    expect(pills[0]).not.toContain('Pause');
    (card.querySelector('.view-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.film-beat')).toBeNull();
    expect(text(root.querySelector('.film-tape-sheet-kicker'))).toBe('Where it turned');
  });

  it('walks the beats with the Prev and Next pills and Shift with an arrow', () => {
    const { fixture, root } = mount(tape);
    // Standing on the turn at 21: the next beat is the death at 24, the one before is the dragon at 8.
    pill(root, 'Next beat').click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-title'))).toBe('Go10x falls, avoidable');
    expect(text(root.querySelector('.film-beat-kicker'))).toBe('24:33 Their way');
    expect(root.querySelector('.film-beat-kicker')?.classList.contains('is-warn')).toBe(true);
    expect((pill(root, 'Next beat') as HTMLButtonElement).disabled).toBe(true);
    pill(root, 'Previous beat').click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-title'))).toBe('Where it turned');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-kicker'))).toBe('8:00 Our way');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-title'))).toBe('First blood, theirs');
    expect((pill(root, 'Previous beat') as HTMLButtonElement).disabled).toBe(true);
  });

  it('pauses on a tapped token with its label and, for a death of ours, the read', () => {
    const { fixture, root } = mount(tape);
    // The map shows only what has happened by the hand's second: the death is on it once the rail has taken the hand there.
    expect(root.querySelector('.rift-token.is-ourDeath')).toBeNull();
    root.querySelectorAll<HTMLButtonElement>('.film-beat-chip')[3].click();
    fixture.detectChanges();
    const token = root.querySelector<HTMLButtonElement>('.rift-token.is-ourDeath');
    expect(token).not.toBeNull();
    token!.click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-tape-sheet-kicker'))).toBe('24:33');
    expect(text(root.querySelector('.film-tape-sheet-text'))).toBe('Go10x (Jungle) died');
    expect(text(root.querySelector('.film-tape-sheet-line'))).toBe('Avoidable: alone on their side of the map.');
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('24:33');
  });

  it('says so without a timeline', () => {
    const { root } = mount(undefined);
    expect(text(root.querySelector('.film-wait'))).toBe('No timeline read for this game, so there is no tape.');
  });
});
