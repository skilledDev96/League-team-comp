import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmBeat, FilmDeathPin, FilmFrame, FilmModel, FilmTape, FilmWard } from '../../../core/film-model';
import { FilmStyle, styleFor, TAPE_SPEED_STORAGE_KEY } from '../../../core/film-style';
import { FilmClock } from '../../../core/film-clock';
import { Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { TeamDataService } from '../../../services/team-data.service';
import { ToastService } from '../../../services/toast.service';
import { beatIsAbout, dwellMsFor, FilmTapeComponent, isDeathBeat, LAB_DEATH_WINDOW_SEC, labSceneAt, neighbourBeat } from './film-tape.component';

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

/** A second death, Rhu's at 9:00, folded into a fight; and Go10x's at 9:15, which the hand-built tape keeps as a beat of its own (the build would fold it; the rail's grouping is what is under test). */
const rhuPin = {
  key: 'd:9:ADC', sec: 540, minute: 9, seat: 'ADC', name: 'Rhu', champion: 'Jinx', zone: 'river', x: 50, y: 50, how: 'fight', could: ['ward'],
  line: 'Minute 9: Jinx in a fight in the river with no ward nearby.', read: 'avoidable', readLine: 'Avoidable: no ward had gone down nearby and three came in.', glyphs: ['ward-off'],
  scene: { could: ['ward'], killers: 3, executed: false, traded: 0, warded: false }
} as FilmDeathPin;
const goPin = {
  key: 'd:9:Jungle', sec: 555, minute: 9, seat: 'Jungle', name: 'Go10x', champion: 'Trundle', zone: 'river', x: 52, y: 48, how: 'fight', could: [],
  line: 'Minute 9: Trundle in a fight in the river.', read: 'traded', readLine: 'Traded: one of theirs fell in the same fight.', glyphs: ['swords'],
  scene: { could: [], killers: 3, executed: false, traded: 1, warded: false }
} as FilmDeathPin;

/** The same tape with a fight at 9:00 that Rhu fell in and Go10x's death at 9:15 beside it: one minute, two beats. */
const busyTape: FilmTape = {
  ...tape,
  events: [
    ...tape.events,
    { sec: 540, kind: 'ourDeath', label: 'Rhu (ADC) died', side: 'us', seat: 'ADC', champion: 'Jinx', zone: 'river', x: 50, y: 50, key: 'd:9:ADC' },
    { sec: 555, kind: 'ourDeath', label: 'Go10x (Jungle) died', side: 'us', seat: 'Jungle', champion: 'Trundle', zone: 'river', x: 52, y: 48, key: 'd:9:Jungle' }
  ],
  beats: [
    beats[0],
    beats[1],
    { key: 'b:fight:540', sec: 540, kind: 'fight', title: 'Fight in the river', text: 'A fight in the river around minute 9: 2 of ours to 1 of theirs.', swing: 'them', glyph: 'swords', seats: ['ADC'], champions: ['Jinx'], deaths: ['d:9:ADC'] },
    { key: 'd:9:Jungle', sec: 555, kind: 'death', title: 'Go10x falls, traded', text: 'Traded: one of theirs fell in the same fight.', swing: 'even', glyph: 'swords', seats: ['Jungle'], champions: ['Trundle'] },
    beats[2],
    beats[3]
  ]
};

/* ---- Part C (10 Sep 2026): a version 3 tape, with the frames and the wards ---- */

const OUR_CHAMPS: Record<Role, string> = { Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona' };
const THEIR_CHAMPS: Record<Role, string> = { Top: 'Sett', Jungle: 'Rammus', Mid: 'Syndra', ADC: 'Caitlyn', Support: 'Nautilus' };

/** Percent space already (the model's contract): ours march up from the blue base and theirs down from the red, a seat a step apart. */
function frameAt(minute: number, shift: number): FilmFrame {
  return {
    minute,
    ours: ROLES.map((seat, i) => ({ seat, champion: OUR_CHAMPS[seat], x: 10 + i * 4 + shift, y: 90 - i * 4 - shift })),
    theirs: ROLES.map((seat, i) => ({ seat, champion: THEIR_CHAMPS[seat], x: 90 - i * 4 - shift, y: 10 + i * 4 + shift }))
  };
}

/** Two frames, minute 0 and minute 30, twenty percent apart, so the blend at any second is easy to say: at 21:00 every token sits seven tenths along. */
const frames: FilmFrame[] = [frameAt(0, 0), frameAt(30, 20)];

const wards: FilmWard[] = [
  // A control ward from 10:00 that stood to the end: live on the turn at 21:00.
  { sec: 600, untilSec: 1800, seat: 'Support', type: 'control', x: 70, y: 72, r: 7 },
  // A trinket at 24:00, gone by 25:30: live on the jungler's death at 24:33, not on the turn.
  { sec: 1440, untilSec: 1530, seat: 'Jungle', type: 'trinket', x: 68, y: 32, r: 7 }
];

const v3Tape: FilmTape = { ...tape, frames, wards };

/** jsdom lays nothing out, so the lab's square is told it is 100 by 100 pixels at the origin: a client pixel is then one percent (the lab's own spec does the same). */
function layOut(el: HTMLElement): void {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
}

function pointer(type: string, x: number, y: number): Event {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 };
  return typeof PointerEvent === 'function' ? new PointerEvent(type, init) : new MouseEvent(type, init);
}

/** The film's own stock leans slow (1.25 on the old base): the tape opens at ½× until the viewer picks. */
const style: FilmStyle = { ...styleFor(7, false), tapeRate: 1.25 };

function modelWith(t: FilmTape | undefined, pins: FilmDeathPin[] = [pin]): FilmModel {
  return {
    matchId: 'EUW1_7000000001',
    tier: 'timeline',
    seed: 7,
    style,
    chapters: [],
    seats: [
      { seat: 'Top', name: 'Ruan', champion: 'Ornn' },
      { seat: 'Jungle', name: 'Go10x', champion: 'Trundle' },
      { seat: 'Mid', name: 'Kai', champion: 'Orianna' },
      { seat: 'ADC', name: 'Rhu', champion: 'Jinx' },
      { seat: 'Support', name: 'Nia', champion: 'Leona' }
    ],
    title: { headline: 'Bled 35 kills', win: false, protagonist: { seat: 'ADC', champion: 'Jinx', name: 'Rhu' }, lowerThird: { date: 0, compName: null, compVerdict: 'off plan', compWhy: '', tier: 'timeline' } },
    tape: t,
    map: t
      ? { pins, theirs: [], clusters: [], summary: { deaths: pins.length, ganks: 0, dark: 0, inReach: 0, alone: 1 }, reads: { avoidable: 1, traded: 0, bought: 0, clean: 0 }, opening: '1 death: 1 avoidable.', costliest: ['d:24:Jungle'], order: 'chronological' }
      : undefined
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

/** The seat tile whose word is `word` ("All", "Jungle"); the All tile's icon ligature is not part of the word. */
function tile(root: HTMLElement, word: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-seat-tile')).find((b) => text(b.querySelector('small')) === word);
  if (!found) throw new Error(`no tile reads ${word}`);
  return found;
}

function chips(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.film-beats .film-beat-chip'));
}

/** The pill among the tape's tools or a beat's actions whose words include `word`. */
function toolPill(root: HTMLElement, word: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-tape-tools .view-btn, .film-beat-actions .view-btn')).find((b) => text(b).includes(word));
  if (!found) throw new Error(`no tool pill reads ${word}`);
  return found;
}

/** A pill on the lab's own toolbar: Move, Ward, Save, Close. */
function labPill(root: HTMLElement, word: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.film-lab-overlay .lab-tools .view-btn')).find((b) => text(b) === word);
}

/** A chip's minute, and its count when it carries one: "9 2". */
function chipText(c: HTMLButtonElement): string {
  return [text(c.querySelector('span')), text(c.querySelector('.film-beat-count'))].filter(Boolean).join(' ');
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

  it('counts a death, and a beat a death was folded into, as a death for Deaths only', () => {
    expect(isDeathBeat(beats[3])).toBe(true);
    expect(isDeathBeat(busyTape.beats[2])).toBe(true);
    expect(isDeathBeat(beats[1])).toBe(false);
    expect(isDeathBeat(beats[0])).toBe(false);
  });

  it('knows which seat a beat is about, by its seats or by the deaths folded into it', () => {
    const seatOf = (key: string) => (key === 'd:9:ADC' ? 'ADC' : undefined);
    expect(beatIsAbout(beats[1], 'Jungle', seatOf)).toBe(true);
    expect(beatIsAbout(beats[1], 'Top', seatOf)).toBe(false);
    expect(beatIsAbout(busyTape.beats[2], 'ADC', seatOf)).toBe(true);
    // A fight whose seats list is full still counts the seat whose death it folded.
    expect(beatIsAbout({ ...busyTape.beats[2], seats: ['Top', 'Mid', 'Support'] }, 'ADC', seatOf)).toBe(true);
    expect(beatIsAbout(beats[2], 'Jungle', seatOf)).toBe(false);
  });

  it('stands the lab on a second: the frame blended to it, the frame a minute before, the wards live then and the deaths within a minute; nothing without frames', () => {
    expect(LAB_DEATH_WINDOW_SEC).toBe(60);
    expect(labSceneAt(undefined, wards, [pin], 1260)).toBeNull();
    expect(labSceneAt([], wards, [pin], 1260)).toBeNull();
    // 24:33: the trinket from 24:00 stands, the control ward too; the jungler's death is on the second.
    const scene = labSceneAt(frames, wards, [rhuPin, goPin, pin], 1473)!;
    expect(scene.sec).toBe(1473);
    expect(scene.frame.minute).toBeCloseTo(1473 / 60, 5);
    expect(scene.frame.ours.find((p) => p.seat === 'Top')).toEqual({ seat: 'Top', champion: 'Ornn', x: 26.4, y: 73.6 });
    expect(scene.previous?.minute).toBeCloseTo(1413 / 60, 5);
    expect(scene.wards.map((w) => w.sec)).toEqual([600, 1440]);
    expect(scene.deaths.map((d) => d.key)).toEqual(['d:24:Jungle']);
    // 9:10: both of the river deaths (9:00 and 9:15) are inside the window, in time order; only the control ward stands.
    const river = labSceneAt(frames, wards, [pin, goPin, rhuPin], 550)!;
    expect(river.deaths.map((d) => d.key)).toEqual(['d:9:ADC', 'd:9:Jungle']);
    expect(river.wards.map((w) => w.sec)).toEqual([]);
    // The first minute has no frame before it: the lab reads no pace and stands its reach on the floor.
    expect(labSceneAt(frames, wards, [], 30)!.previous).toBeNull();
    expect(labSceneAt(frames, wards, [], 60)!.previous?.minute).toBe(0);
    // A fresh frame every time, so the lab can drag without moving the tape's own.
    expect(labSceneAt(frames, wards, [], 0)!.frame).not.toBe(frames[0]);
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

  function mount(t: FilmTape | undefined, inputs: Record<string, unknown> = {}, pins?: FilmDeathPin[]) {
    const fixture = TestBed.createComponent(FilmTapeComponent);
    fixture.componentRef.setInput('model', modelWith(t, pins));
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
    // The rail: one chip per minute, glyph and minute (the death at 24:33 is minute 24, as the ledger keys it), the turn's lit since the hand stands on it.
    const rail = chips(root);
    expect(rail).toHaveLength(4);
    expect(rail.map(chipText)).toEqual(['4', '8', '21', '24']);
    expect(rail.map((c) => c.querySelector('.film-glyph')?.getAttribute('data-glyph'))).toEqual(['blood', 'dragon', 'coin', 'footsteps']);
    expect(rail[2].classList.contains('is-current')).toBe(true);
    expect(rail[1].classList.contains('is-current')).toBe(false);
    expect(root.querySelector('.film-beat-count')).toBeNull();
    expect(root.querySelector('.film-beat-chip.is-skipped')).toBeNull();
    // Nothing is full screen and every seat is on the map until the reader says otherwise.
    expect(root.querySelector('.film-tape.is-full')).toBeNull();
    expect(root.querySelector('.film-full-close')).toBeNull();
    expect(root.querySelector('.rift-map.has-seat-filter')).toBeNull();
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
    chips(root)[1].click();
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
    expect(card.querySelector('.film-beat-deaths')).toBeNull();
    expect(root.querySelector('.film-beat-chip.is-current')).toBe(chips(root)[1]);
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
    chips(root)[3].click();
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

  it('offers four speeds, opens at the film\'s own, and a pick sets the clock\'s rate at once and is remembered', () => {
    const first = mount(tape);
    const speedPills = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('.film-speed .view-btn'));
    expect(speedPills(first.root).map((b) => text(b))).toEqual(['½×', '1×', '2×', '4×']);
    // The stock leans slow, so the tape opens at ½×; the group says what that means once, as a tip.
    expect(speedPills(first.root).find((b) => b.classList.contains('active'))?.textContent?.trim()).toBe('½×');
    expect(first.root.querySelector('.film-speed')?.getAttribute('aria-label')).toBe('Tape speed');
    // The pick reaches the running clock through setRate (it keeps its second), turns the pill and lands in storage.
    const clock = first.fixture.componentInstance['clock']() as FilmClock;
    const setRate = vi.spyOn(clock, 'setRate');
    speedPills(first.root)[3].click();
    first.fixture.detectChanges();
    expect(setRate).toHaveBeenCalledWith(0.75);
    expect(speedPills(first.root).find((b) => b.classList.contains('active'))?.textContent?.trim()).toBe('4×');
    expect(speedPills(first.root)[3].getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(TAPE_SPEED_STORAGE_KEY)).toBe('faster');
    expect(text(first.root.querySelector('.film-scrub-clock'))).toBe('21:00');
    first.fixture.destroy();
    // The next film opens at the remembered step, whatever its stock leans to.
    const second = mount(tape);
    expect(speedPills(second.root).find((b) => b.classList.contains('active'))?.textContent?.trim()).toBe('4×');
    second.fixture.destroy();
    // A value the steps do not name falls back to the film's own.
    localStorage.setItem(TAPE_SPEED_STORAGE_KEY, 'warp');
    const third = mount(tape);
    expect(speedPills(third.root).find((b) => b.classList.contains('active'))?.textContent?.trim()).toBe('½×');
  });

  it('shows one seat at a time: the tiles set the Rift\'s view, the tape skips the beats not about the seat, and the rail dims them', () => {
    const { fixture, root } = mount(tape);
    const tiles = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-seat-tiles .film-seat-tile'));
    expect(tiles.map((t) => text(t.querySelector('small')))).toEqual(['All', 'Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    expect(tiles.slice(1).map((t) => t.querySelector('img')?.getAttribute('alt'))).toEqual(['Ornn', 'Trundle', 'Orianna', 'Jinx', 'Leona']);
    expect(tile(root, 'All').classList.contains('active')).toBe(true);
    const skipped = () => chips(root).map((c) => c.classList.contains('is-skipped'));

    tile(root, 'Jungle').click();
    fixture.detectChanges();
    expect(tile(root, 'Jungle').getAttribute('aria-pressed')).toBe('true');
    expect(tile(root, 'All').classList.contains('active')).toBe(false);
    expect(root.querySelector('.rift-map.has-seat-filter')).not.toBeNull();
    // The first blood and the turn are about nobody in particular: dimmed on the rail, skipped by the walk.
    expect(skipped()).toEqual([true, false, true, false]);
    expect(chips(root)).toHaveLength(4);
    // Standing on the turn at 21: Next is the jungler's death at 24, Previous the dragon at 8 the jungler was in, then nothing.
    pill(root, 'Next beat').click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-title'))).toBe('Go10x falls, avoidable');
    pill(root, 'Previous beat').click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-kicker'))).toBe('8:00 Our way');
    expect((pill(root, 'Previous beat') as HTMLButtonElement).disabled).toBe(true);

    // The ADC's view: only the dragon at 8 is about her; the hand stands on it, so neither way has a beat.
    tile(root, 'ADC').click();
    fixture.detectChanges();
    expect(skipped()).toEqual([true, false, true, true]);
    expect((pill(root, 'Next beat') as HTMLButtonElement).disabled).toBe(true);
    expect((pill(root, 'Previous beat') as HTMLButtonElement).disabled).toBe(true);
    // The card standing stays; only the walk changed.
    expect(text(root.querySelector('.film-beat-kicker'))).toBe('8:00 Our way');

    tile(root, 'All').click();
    fixture.detectChanges();
    expect(skipped()).toEqual([false, false, false, false]);
    expect(root.querySelector('.rift-map.has-seat-filter')).toBeNull();
    expect((pill(root, 'Next beat') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the deaths\' minutes alone on the rail under Deaths only, and the tape stops on those alone', () => {
    const { fixture, root } = mount(tape);
    const deathsOnly = root.querySelector<HTMLButtonElement>('.film-deaths-only')!;
    expect(deathsOnly.getAttribute('aria-pressed')).toBe('false');
    deathsOnly.click();
    fixture.detectChanges();
    expect(deathsOnly.getAttribute('aria-pressed')).toBe('true');
    expect(deathsOnly.classList.contains('active')).toBe(true);
    expect(chips(root).map(chipText)).toEqual(['24']);
    // Standing on the turn at 21: nothing before, the death after.
    expect((pill(root, 'Previous beat') as HTMLButtonElement).disabled).toBe(true);
    pill(root, 'Next beat').click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-title'))).toBe('Go10x falls, avoidable');
    deathsOnly.click();
    fixture.detectChanges();
    expect(chips(root).map(chipText)).toEqual(['4', '8', '21', '24']);
    expect((pill(root, 'Previous beat') as HTMLButtonElement).disabled).toBe(false);
  });

  it('folds a minute into one chip with a count, lists a fight\'s deaths with their reads, and Continue walks the minute before the tape plays on', () => {
    const { fixture, root } = mount(busyTape, {}, [rhuPin, goPin, pin]);
    const rail = chips(root);
    expect(rail.map(chipText)).toEqual(['4', '8', '9 2', '21', '24']);
    expect(rail[2].querySelector('.film-glyph')?.getAttribute('data-glyph')).toBe('swords');
    expect(text(rail[2].querySelector('.film-beat-count'))).toBe('2');
    expect(rail[2].getAttribute('aria-label')).toBe('Fight in the river, Go10x falls, traded, 9:00');
    // Deaths only keeps the minute: the fight folded a death, and the jungler's is a beat of its own.
    root.querySelector<HTMLButtonElement>('.film-deaths-only')!.click();
    fixture.detectChanges();
    expect(chips(root).map(chipText)).toEqual(['9 2', '24']);
    root.querySelector<HTMLButtonElement>('.film-deaths-only')!.click();
    fixture.detectChanges();

    chips(root)[2].click();
    fixture.detectChanges();
    let card = root.querySelector('.film-beat')!;
    expect(card.getAttribute('data-kind')).toBe('fight');
    expect(text(card.querySelector('.film-beat-title'))).toBe('Fight in the river');
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('9:00');
    expect(chips(root)[2].classList.contains('is-current')).toBe(true);
    // Rhu fell in it: her tile with the read's badge under the text, and not again among the champions it was about.
    const deaths = Array.from(card.querySelectorAll('.film-beat-death'));
    expect(deaths).toHaveLength(1);
    expect(deaths[0].querySelector('img')?.getAttribute('alt')).toBe('Jinx');
    expect(text(deaths[0].querySelector('.film-beat-death-who'))).toBe('Rhu 9:00');
    expect(text(deaths[0].querySelector('.film-read-badge'))).toBe('Avoidable');
    expect(deaths[0].querySelector('.film-read-badge')?.classList.contains('is-read-avoidable')).toBe(true);
    expect(card.querySelector('.film-beat-tiles')).toBeNull();
    // Continue walks to the minute's second beat, still standing; then the sheet goes back to the turn (nothing plays with motion off).
    (card.querySelector('.view-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    card = root.querySelector('.film-beat')!;
    expect(text(card.querySelector('.film-beat-title'))).toBe('Go10x falls, traded');
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('9:15');
    expect(chips(root)[2].classList.contains('is-current')).toBe(true);
    (card.querySelector('.view-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.film-beat')).toBeNull();
    expect(text(root.querySelector('.film-tape-sheet-kicker'))).toBe('Where it turned');
  });

  it('walks only the seat\'s beats of a minute opened from the rail, and the whole minute from a dimmed chip', () => {
    const { fixture, root } = mount(busyTape, {}, [rhuPin, goPin, pin]);
    tile(root, 'Jungle').click();
    fixture.detectChanges();
    // Minute 9 holds the fight (Rhu's) and the jungler's death: under the jungler's view the chip is not dimmed, and the walk opens on his death alone.
    expect(chips(root)[2].classList.contains('is-skipped')).toBe(false);
    chips(root)[2].click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-title'))).toBe('Go10x falls, traded');
    (root.querySelector('.film-beat .view-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.film-beat')).toBeNull();
    // A dimmed chip (the turn, about nobody) still opens when asked.
    expect(chips(root)[3].classList.contains('is-skipped')).toBe(true);
    chips(root)[3].click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-title'))).toBe('Where it turned');
  });

  it('takes the full screen, the side column becoming a drawer that Escape closes before the full screen, and a beat brings back', () => {
    const { fixture, root } = mount(tape);
    // Every Escape that closes something is reported to the page, which then does not count it towards leaving the film (10 Sep 2026, second fix pass).
    let escaped = 0;
    fixture.componentInstance.escaped.subscribe(() => escaped++);
    const fullBtn = () => root.querySelector<HTMLButtonElement>('.film-full-btn')!;
    expect(text(fullBtn())).toBe('fullscreen Full screen');
    fullBtn().click();
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-full')).not.toBeNull();
    expect(root.querySelector('.film-tape.is-drawer-closed')).toBeNull();
    expect(text(fullBtn())).toBe('fullscreen_exit Exit full screen');
    expect(fullBtn().getAttribute('aria-pressed')).toBe('true');
    // The close pill leads the drawer; the sheet and the rail are still in it.
    const side = root.querySelector('.film-tape-side')!;
    expect(side.firstElementChild?.classList.contains('film-full-close')).toBe(true);
    expect(side.querySelector('.film-tape-sheet')).not.toBeNull();
    expect(side.querySelector('.film-beats')).not.toBeNull();
    expect(root.querySelector('.film-full-open')).toBeNull();
    // Close the drawer: the Rift stands alone with a pill to bring the sheet back.
    (side.firstElementChild as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-full.is-drawer-closed')).not.toBeNull();
    expect(root.querySelector('.film-tape-map .film-full-open')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.film-full-open')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-drawer-closed')).toBeNull();
    // Escape once closes the drawer, Escape again leaves the full screen.
    expect(escaped).toBe(0);
    fixture.componentRef.setInput('closeTick', 1);
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-full.is-drawer-closed')).not.toBeNull();
    expect(escaped).toBe(1);
    // A beat landing in the sheet brings the drawer back: the card is what the stop is for.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-kicker'))).toBe('8:00 Our way');
    expect(root.querySelector('.film-tape.is-drawer-closed')).toBeNull();
    fixture.componentRef.setInput('closeTick', 2);
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-drawer-closed')).not.toBeNull();
    expect(escaped).toBe(2);
    fixture.componentRef.setInput('closeTick', 3);
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-full')).toBeNull();
    expect(root.querySelector('.film-full-close')).toBeNull();
    expect(root.querySelector('.film-full-open')).toBeNull();
    expect(text(fullBtn())).toBe('fullscreen Full screen');
    expect(escaped).toBe(3);
    // Escape outside full screen changes nothing on the tape, and says nothing: that press is the page's to count.
    fixture.componentRef.setInput('closeTick', 4);
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-full')).toBeNull();
    expect(escaped).toBe(3);
  });

  it('says so without a timeline', () => {
    const { root } = mount(undefined);
    expect(text(root.querySelector('.film-wait'))).toBe('No timeline read for this game, so there is no tape.');
  });

  /* ---- Part C (10 Sep 2026): the layers and the position lab ---- */

  it('grows the layer pills on a version 3 tape: Everyone on with the ten on the Rift, Vision off until asked, and the corner note saying so; an older tape has neither', () => {
    const { fixture, root } = mount(v3Tape);
    const layer = (word: string) => {
      const found = Array.from(root.querySelectorAll<HTMLButtonElement>('.film-layers .view-btn')).find((b) => text(b).includes(word));
      if (!found) throw new Error(`no layer pill reads ${word}`);
      return found;
    };
    expect(root.querySelector('.film-layers')?.getAttribute('aria-label')).toBe('Layers on the Rift');
    expect(text(layer('Everyone'))).toBe('groups Everyone');
    expect(layer('Everyone').getAttribute('aria-pressed')).toBe('true');
    expect(layer('Vision').getAttribute('aria-pressed')).toBe('false');
    expect(layer('Vision').querySelector('.film-glyph')?.getAttribute('data-glyph')).toBe('ward');
    // The ten stand on the Rift at the turn's second as a layer, theirs a champion in a seat and never a name.
    expect(root.querySelectorAll('.rift-live-token')).toHaveLength(10);
    expect(root.querySelector('.rift-live-token.is-theirs .rift-live-tile')?.getAttribute('aria-label')).toBe('Their Top · Sett');
    expect(root.querySelector('.rift-vision')).toBeNull();
    expect(text(root.querySelector('.rift-map-note'))).toBe('Approximate, by zone · positions once a minute');
    // Vision: the control ward from 10:00 stands on the turn at 21:00 with its sight; the trinket from 24:00 does not yet.
    layer('Vision').click();
    fixture.detectChanges();
    expect(layer('Vision').classList.contains('active')).toBe(true);
    expect(layer('Vision').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.rift-ward')).toHaveLength(1);
    expect(root.querySelector('.rift-ward')?.classList.contains('is-control')).toBe(true);
    expect(root.querySelectorAll('.rift-sight')).toHaveLength(1);
    expect(text(root.querySelector('.rift-map-note'))).toBe('Approximate, by zone · positions once a minute · wards where the placer stood');
    // Everyone off: the live layer goes and the note drops its clause.
    layer('Everyone').click();
    fixture.detectChanges();
    expect(layer('Everyone').getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.rift-live')).toBeNull();
    expect(text(root.querySelector('.rift-map-note'))).toBe('Approximate, by zone · wards where the placer stood');
    // Every action stayed a pill.
    expect(root.querySelectorAll('.film-tape-tools a')).toHaveLength(0);
    // An older timeline: no pills, no lab, no layer, and the note as it was.
    const older = mount(tape);
    expect(older.root.querySelector('.film-layers')).toBeNull();
    expect(older.root.querySelector('.film-lab-btn')).toBeNull();
    expect(older.root.querySelector('.rift-live')).toBeNull();
    expect(text(older.root.querySelector('.rift-map-note'))).toBe('Approximate, by zone');
  });

  it('opens the position lab on the hand\'s second over the frame, the Rift paused and its keys the lab\'s, and Close brings the tape back', () => {
    const { fixture, root } = mount(v3Tape);
    expect(text(toolPill(root, 'Work on this second'))).toBe('draw Work on this second');
    expect(root.querySelector('.film-lab-overlay')).toBeNull();
    toolPill(root, 'Work on this second').click();
    fixture.detectChanges();
    const overlay = root.querySelector<HTMLElement>('.film-lab-overlay')!;
    // A real <dialog> (10 Sep 2026): the role is the element's own, and the top layer is what keeps the tape's pills off it.
    expect(overlay.tagName).toBe('DIALOG');
    expect(overlay.getAttribute('aria-label')).toBe('Work on 21:00');
    expect(overlay.querySelector('.lab-square')?.getAttribute('aria-label')).toBe('Position lab at 21:00');
    expect(overlay.querySelectorAll('.lab-token')).toHaveLength(10);
    // The ten stand where the blend puts them at 21:00, seven tenths of the way from minute 0 to minute 30: Top from (10, 90) to (30, 70) is (24, 76).
    expect(overlay.querySelector<HTMLElement>('.lab-token.is-us[data-seat="Top"]')?.style.transform).toBe('translate(24%, 76%)');
    // Theirs: a champion in a seat, never a name; the reach off the frame a minute before.
    expect(overlay.querySelector('.lab-token.is-them[data-seat="Jungle"] .lab-tile')?.getAttribute('aria-label')).toBe('Their Jungle (Rammus), where the minute put them (approximate)');
    expect(overlay.querySelectorAll('.lab-reach')).toHaveLength(5);
    // The one ward live at 21:00, and no death within a minute of it.
    expect(overlay.querySelectorAll('.lab-ward.is-game')).toHaveLength(1);
    expect(overlay.querySelectorAll('.lab-death')).toHaveLength(0);
    expect(text(overlay.querySelector('.lab-note'))).toBe('Approximate, by the minute');
    for (const word of ['drill', 'quiz', 'score']) expect(overlay.textContent?.toLowerCase()).not.toContain(word);
    // Nothing plays under it, and a space over the lab is not a play.
    const clock = fixture.componentInstance['clock']() as FilmClock;
    expect(clock.playing()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    fixture.detectChanges();
    expect(clock.playing()).toBe(false);
    expect(root.querySelector('.film-lab-overlay')).not.toBeNull();
    // Close: the tape is back, still standing on 21:00.
    labPill(root, 'Close')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay')).toBeNull();
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('21:00');
    expect(clock.playing()).toBe(false);
  });

  /** Lets a save land: the note's write is awaited before the toast (10 Sep 2026, second fix pass). */
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('saves the drawing as a film note keyed on the second with the lab\'s reading line, and says so once the write lands; a viewer gets the lab without Save', async () => {
    const { fixture, root } = mount(v3Tape);
    const data = TestBed.inject(TeamDataService);
    const save = vi.spyOn(data, 'saveFilmNote');
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
    toolPill(root, 'Work on this second').click();
    fixture.detectChanges();
    const overlay = root.querySelector<HTMLElement>('.film-lab-overlay')!;
    const square = overlay.querySelector<HTMLElement>('.lab-square')!;
    layOut(square);
    expect(labPill(root, 'Save')?.disabled).toBe(true);
    // Drag Jinx from where the blend put her (36, 64) to the middle of the map: the reading changes and Save wakes.
    overlay.querySelector<HTMLElement>('.lab-token.is-us[data-seat="ADC"] .lab-tile')!.dispatchEvent(pointer('pointerdown', 36, 64));
    square.dispatchEvent(pointer('pointermove', 50, 50));
    square.dispatchEvent(pointer('pointerup', 50, 50));
    fixture.detectChanges();
    const line = text(overlay.querySelector('.lab-reading'));
    expect(line).not.toBe('');
    expect(labPill(root, 'Save')?.disabled).toBe(false);
    labPill(root, 'Save')!.click();
    expect(toast).not.toHaveBeenCalled();
    await flush();
    fixture.detectChanges();
    expect(save).toHaveBeenCalledTimes(1);
    const [matchId, key, noteText, drawing] = save.mock.calls[0];
    expect(matchId).toBe('EUW1_7000000001');
    expect(key).toBe('lab:1260');
    expect(noteText).toBe(line);
    expect(drawing).toEqual({ sec: 1260, moved: [{ seat: 'ADC', x: 50, y: 50 }], wards: [], arrows: [] });
    // Local mode keeps it: the note stands on the film with the drawing under it.
    expect(data.notesFor('EUW1_7000000001')?.notes['lab:1260']).toMatchObject({ text: line, lab: { sec: 1260 } });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe("Saved to the film's notes");
    expect(toast.mock.calls[0][1]).toMatchObject({ kind: 'ok' });
    expect(toast.mock.calls[0][1]?.text).toContain('21:00');
    // The lab stays open on the board as saved: Save sleeps until the board changes; Close returns.
    expect(root.querySelector('.film-lab-overlay')).not.toBeNull();
    expect(labPill(root, 'Save')?.disabled).toBe(true);
    fixture.destroy();

    // A viewer: the board the editor saved on 21:00 is theirs to open too (the pill says so), with the lab, its reading and Close, and no Save pill that would write.
    vi.spyOn(TestBed.inject(AuthService), 'canEdit').mockReturnValue(false);
    const viewer = mount(v3Tape);
    toolPill(viewer.root, 'Open the board').click();
    viewer.fixture.detectChanges();
    expect(viewer.root.querySelector('.film-lab-overlay')).not.toBeNull();
    expect(viewer.root.querySelectorAll('.film-lab-overlay .lab-token.is-moved')).toHaveLength(1);
    expect(labPill(viewer.root, 'Save')).toBeUndefined();
    expect(labPill(viewer.root, 'Close')).toBeDefined();
    expect(viewer.root.querySelector('.film-lab-overlay .lab-reading')).not.toBeNull();
  });

  it('closes the lab on Escape before the drawer or the full screen, and says so; the lab\'s own Escape closes it too', () => {
    const { fixture, root } = mount(v3Tape);
    let escaped = 0;
    fixture.componentInstance.escaped.subscribe(() => escaped++);
    root.querySelector<HTMLButtonElement>('.film-full-btn')!.click();
    fixture.detectChanges();
    toolPill(root, 'Work on this second').click();
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay')).not.toBeNull();
    fixture.componentRef.setInput('closeTick', 1);
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay')).toBeNull();
    expect(escaped).toBe(1);
    // That press was the lab's: the full screen and its drawer stand as they were.
    expect(root.querySelector('.film-tape.is-full')).not.toBeNull();
    expect(root.querySelector('.film-tape.is-drawer-closed')).toBeNull();
    // The lab's own Escape (its square has the focus) closes it without the press reaching the page.
    toolPill(root, 'Work on this second').click();
    fixture.detectChanges();
    root.querySelector('.film-lab-overlay .lab')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay')).toBeNull();
    expect(escaped).toBe(1);
    // The next page Escape is the drawer's, as before.
    fixture.componentRef.setInput('closeTick', 2);
    fixture.detectChanges();
    expect(root.querySelector('.film-tape.is-full.is-drawer-closed')).not.toBeNull();
    expect(escaped).toBe(2);
  });

  it('opens the lab where the map\'s Work on this second asks, on the death\'s own second, standing', () => {
    const { fixture, root } = mount(v3Tape);
    fixture.componentRef.setInput('seekTo', { sec: 1473, n: 1, lab: true });
    fixture.detectChanges();
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('24:33');
    expect(root.querySelector('.film-lab-overlay .lab-square')?.getAttribute('aria-label')).toBe('Position lab at 24:33');
    // The jungler's death at 24:33 is inside the lab's window, and both wards stand at that second.
    expect(root.querySelectorAll('.film-lab-overlay .lab-death')).toHaveLength(1);
    expect(root.querySelectorAll('.film-lab-overlay .lab-ward.is-game')).toHaveLength(2);
    expect((fixture.componentInstance['clock']() as FilmClock).playing()).toBe(false);
    // The same request again is not a second opening; a Watch it is never a lab.
    labPill(root, 'Close')!.click();
    fixture.detectChanges();
    fixture.componentRef.setInput('seekTo', { sec: 1453, n: 2, play: true });
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay')).toBeNull();
    expect(text(root.querySelector('.film-scrub-clock'))).toBe('24:13');
  });

  it('offers Work on this second on a death\'s card and not on a moment\'s, opening the lab on the death\'s second', () => {
    const { fixture, root } = mount(v3Tape);
    chips(root)[1].click();
    fixture.detectChanges();
    expect(root.querySelector('.film-beat-actions .film-lab-btn')).toBeNull();
    chips(root)[3].click();
    fixture.detectChanges();
    const btn = root.querySelector<HTMLButtonElement>('.film-beat-actions .film-lab-btn')!;
    expect(text(btn)).toBe('draw Work on this second');
    btn.click();
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay .lab-square')?.getAttribute('aria-label')).toBe('Position lab at 24:33');
    // A fight a death was folded into counts: its second is the death's.
    const busy = mount({ ...busyTape, frames, wards }, {}, [rhuPin, goPin, pin]);
    chips(busy.root)[2].click();
    busy.fixture.detectChanges();
    expect(text(busy.root.querySelector('.film-beat-title'))).toBe('Fight in the river');
    expect(busy.root.querySelector('.film-beat-actions .film-lab-btn')).not.toBeNull();
    // An older tape's death card has no such pill.
    const older = mount(tape);
    chips(older.root)[3].click();
    older.fixture.detectChanges();
    expect(older.root.querySelector('.film-beat-actions .film-lab-btn')).toBeNull();
  });

  it('opens the lab on the folded death\'s own second from a moment\'s card, not the moment\'s (10 Sep 2026, second fix pass)', () => {
    // The dragon moment at 8:00 with Rhu's death at 9:00 folded into it: the second the lab opens on is the death's.
    const folded: FilmTape = { ...v3Tape, beats: [beats[0], { ...beats[1], deaths: ['d:9:ADC'] }, beats[2], beats[3]] };
    const { fixture, root } = mount(folded, {}, [rhuPin, pin]);
    chips(root)[1].click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-tape-sheet-text'))).toBe('Dragon at 8 with all five nearby.');
    expect(root.querySelectorAll('.film-beat-death')).toHaveLength(1);
    const btn = root.querySelector<HTMLButtonElement>('.film-beat-actions .film-lab-btn')!;
    expect(text(btn)).toBe('draw Work on this second');
    btn.click();
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay .lab-square')?.getAttribute('aria-label')).toBe('Position lab at 9:00');
  });

  it('keeps a saved board on the film: reopening the lab on the second brings the drawing back, Save waits for a change, the rail and the card say a board is there, and a cleared board comes off (10 Sep 2026, second fix pass)', async () => {
    const { fixture, root } = mount(v3Tape);
    const data = TestBed.inject(TeamDataService);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'show');
    // From the death's card: the lab on 24:33.
    chips(root)[3].click();
    fixture.detectChanges();
    expect(text(root.querySelector('.film-beat-actions .film-lab-btn'))).toBe('draw Work on this second');
    root.querySelector<HTMLButtonElement>('.film-beat-actions .film-lab-btn')!.click();
    fixture.detectChanges();
    let overlay = root.querySelector<HTMLElement>('.film-lab-overlay')!;
    const square = overlay.querySelector<HTMLElement>('.lab-square')!;
    layOut(square);
    // Draw a path across the map and save it.
    labPill(root, 'Path')!.click();
    fixture.detectChanges();
    square.dispatchEvent(pointer('pointerdown', 20, 20));
    square.dispatchEvent(pointer('pointermove', 40, 40));
    square.dispatchEvent(pointer('pointerup', 40, 40));
    fixture.detectChanges();
    expect(overlay.querySelectorAll('.lab-arrow')).toHaveLength(1);
    labPill(root, 'Save')!.click();
    await flush();
    fixture.detectChanges();
    expect(data.notesFor('EUW1_7000000001')?.notes['lab:1473']?.lab?.arrows).toEqual([{ x1: 20, y1: 20, x2: 40, y2: 40, kind: 'path' }]);
    // The lab stays open on the board as saved: Save sleeps until something changes.
    expect(root.querySelector('.film-lab-overlay')).not.toBeNull();
    expect(labPill(root, 'Save')?.disabled).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
    // Close: the rail's minute and the death's card both say a board is there.
    labPill(root, 'Close')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.film-lab-overlay')).toBeNull();
    expect(chips(root)[3].classList.contains('has-board')).toBe(true);
    expect(chips(root)[3].getAttribute('aria-label')).toContain('a board saved');
    expect(chips(root)[2].classList.contains('has-board')).toBe(false);
    const open = root.querySelector<HTMLButtonElement>('.film-beat-actions .film-lab-btn')!;
    expect(text(open)).toBe('draw Open the board');
    open.click();
    fixture.detectChanges();
    overlay = root.querySelector<HTMLElement>('.film-lab-overlay')!;
    expect(overlay.querySelector('.lab-square')?.getAttribute('aria-label')).toBe('Position lab at 24:33');
    expect(overlay.querySelectorAll('.lab-arrow')).toHaveLength(1);
    expect(overlay.querySelector('.lab-arrow')?.getAttribute('x2')).toBe('40');
    expect(labPill(root, 'Save')?.disabled).toBe(true);
    // Reset clears the board; Save then takes the note off the film.
    labPill(root, 'Reset')!.click();
    fixture.detectChanges();
    expect(overlay.querySelectorAll('.lab-arrow')).toHaveLength(0);
    expect(labPill(root, 'Save')?.disabled).toBe(false);
    labPill(root, 'Save')!.click();
    await flush();
    fixture.detectChanges();
    expect(data.notesFor('EUW1_7000000001')?.notes['lab:1473']).toBeUndefined();
    expect(toast).toHaveBeenLastCalledWith("Board taken off the film's notes", expect.objectContaining({ kind: 'ok' }));
    labPill(root, 'Close')!.click();
    fixture.detectChanges();
    expect(chips(root)[3].classList.contains('has-board')).toBe(false);
    expect(text(root.querySelector('.film-beat-actions .film-lab-btn'))).toBe('draw Work on this second');
  });
});
