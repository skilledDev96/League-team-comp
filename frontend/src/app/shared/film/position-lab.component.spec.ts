import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { FilmDeathPin, FilmFrame, FilmWard } from '../../core/film-model';
import { FilmLabDrawing } from '../../models/team.models';
import { LAB_NOTE_TIP, MAX_LAB_DEATHS, PositionLabComponent } from './position-lab.component';

const frame: FilmFrame = {
  minute: 14,
  ours: [
    { seat: 'Top', champion: 'Ornn', x: 13, y: 34 },
    { seat: 'Jungle', champion: 'LeeSin', x: 26, y: 46 },
    { seat: 'Mid', champion: 'Ahri', x: 42, y: 58 },
    { seat: 'ADC', champion: 'Jinx', x: 62, y: 87 },
    { seat: 'Support', champion: 'Leona', x: 71, y: 81 }
  ],
  theirs: [
    { seat: 'Top', champion: 'Aatrox', x: 30, y: 12 },
    { seat: 'Jungle', champion: 'Vi', x: 48, y: 26 },
    { seat: 'Mid', champion: 'Syndra', x: 58, y: 42 },
    { seat: 'ADC', champion: 'Kaisa', x: 89, y: 38 },
    { seat: 'Support', x: 83, y: 47 }
  ]
};

const previous: FilmFrame = {
  minute: 13,
  ours: frame.ours,
  theirs: [
    { seat: 'Top', champion: 'Aatrox', x: 28, y: 12 },
    { seat: 'Jungle', champion: 'Vi', x: 60, y: 30 },
    { seat: 'Mid', champion: 'Syndra', x: 58, y: 42 },
    { seat: 'ADC', champion: 'Kaisa', x: 89, y: 40 },
    { seat: 'Support', x: 83, y: 45 }
  ]
};

const wards: FilmWard[] = [
  { sec: 800, untilSec: 890, seat: 'Support', type: 'trinket', x: 70, y: 75, r: 6 },
  { sec: 100, untilSec: 190, seat: 'Jungle', type: 'trinket', x: 30, y: 60, r: 6 }
];

const pin: FilmDeathPin = {
  key: 'd:14:ADC', sec: 850, minute: 14, seat: 'ADC', name: 'Rhu', champion: 'Jinx', zone: 'bot', x: 85, y: 84, placed: 'zone', how: 'gank', could: ['ward'],
  line: 'Rhu (ADC) died at 14 min, in the dark', read: 'avoidable', readLine: 'Avoidable: no ward had gone down nearby.', glyphs: ['ward-off'],
  scene: { could: ['ward'], killers: 2, executed: false, traded: 0, warded: false }
};

const ours = [
  { seat: 'Top' as const, champion: 'Ornn', name: 'A' },
  { seat: 'Jungle' as const, champion: 'LeeSin', name: 'B' },
  { seat: 'Mid' as const, champion: 'Ahri', name: 'C' },
  { seat: 'ADC' as const, champion: 'Jinx', name: 'Rhu' },
  { seat: 'Support' as const, champion: 'Leona', name: 'E' }
];

/** jsdom lays nothing out, so the square is told it is 100 by 100 pixels at the origin: a client pixel is then one percent. */
function layOut(el: HTMLElement): void {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
}

function pointer(type: string, x: number, y: number): Event {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 };
  return typeof PointerEvent === 'function' ? new PointerEvent(type, init) : new MouseEvent(type, init);
}

function pill(el: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll<HTMLButtonElement>('.lab-tools .view-btn')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no pill ${text}`);
  return btn;
}

/** A token's box is slid by transform alone; this reads the place back out of it. */
const slidTo = (box: HTMLElement): string => box.style.transform;
const tile = (box: HTMLElement): HTMLButtonElement => box.querySelector('.lab-tile') as HTMLButtonElement;

describe('PositionLabComponent', () => {
  function mount(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(PositionLabComponent);
    const base: Record<string, unknown> = { sec: 840, ourSide: 'blue', frame, previous, wards, deaths: [pin], ours, matchId: 'EUW1_1' };
    for (const [k, v] of Object.entries({ ...base, ...inputs })) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    layOut(el.querySelector('.lab-square') as HTMLElement);
    return { fixture, el };
  }

  const ourToken = (el: HTMLElement, champion: string) =>
    Array.from(el.querySelectorAll<HTMLElement>('.lab-token.is-us')).find((b) => tile(b).getAttribute('aria-label')?.includes(champion)) as HTMLElement;

  it('stands the ten where the frame put them, with the live wards, the reaches and the note', () => {
    const { el } = mount();
    expect(el.querySelectorAll('.lab-token').length).toBe(10);
    expect(el.querySelectorAll('.lab-token.is-us').length).toBe(5);
    expect(el.querySelectorAll('.lab-token.is-them').length).toBe(5);
    const jinx = ourToken(el, 'Jinx');
    expect(slidTo(jinx)).toBe('translate(62%, 87%)');
    expect(jinx.getAttribute('data-seat')).toBe('ADC');
    expect(tile(jinx).getAttribute('aria-label')).toBe('Jinx (ADC), where the minute put them (approximate)');
    expect(tile(jinx).querySelector('img')?.getAttribute('src')).toContain('Jinx');
    // Only the ward live at 14:00 shows, at its placer's spot, and says so; the mark is the film's own ward glyph.
    expect(el.querySelectorAll('.lab-ward.is-game').length).toBe(1);
    expect(el.querySelector('.lab-ward.is-game')?.getAttribute('aria-label')).toBe('Trinket, where Support stood at the nearest minute (approximate)');
    expect(el.querySelector('.lab-ward.is-game svg')?.getAttribute('data-glyph')).toBe('ward');
    expect(el.querySelectorAll('.lab-sight').length).toBe(1);
    expect(el.querySelectorAll('.lab-reach').length).toBe(5);
    expect(el.querySelectorAll('.lab-death').length).toBe(1);
    expect(el.querySelector('.lab-death')?.getAttribute('aria-label')).toBe(pin.line);
    expect(el.querySelector('.lab-death svg')?.getAttribute('data-glyph')).toBe('skull');
    // Nothing on the square is a Material icon: every mark is one of the film's own glyphs. (The tools row is chrome and may carry one — the marks legend's pill does.)
    expect(el.querySelector('.lab-square .material-symbols-rounded')).toBeNull();
    expect(el.querySelector('.lab-note')?.textContent).toBe('Approximate, by the minute');
    expect(LAB_NOTE_TIP).toContain('once a minute');
    expect(el.querySelector('.lab-square')?.getAttribute('aria-label')).toBe('Position lab at 14:00');
    expect(el.querySelectorAll('.lab-cell').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.lab-cell.is-safe').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.lab-cell.is-danger').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.lab-ghost').length).toBe(0);
    expect(el.querySelector('.lab-reading')?.textContent).toBe('Drag one of ours, or put a ward down, and this line reads the difference');
    for (const word of ['drill', 'quiz', 'score']) expect(el.textContent?.toLowerCase()).not.toContain(word);
  });

  it('carries no name of theirs: a champion in a seat, or the seat alone', () => {
    const { el } = mount();
    const labels = Array.from(el.querySelectorAll('.lab-token.is-them .lab-tile')).map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels[1]).toBe('Their Jungle (Vi), where the minute put them (approximate)');
    expect(labels[4]).toBe('Their Support, where the minute put them (approximate)');
    for (const l of labels) expect(l.startsWith('Their ')).toBe(true);
    expect(el.textContent).not.toContain('Rhu');
    // Their tokens never move: no pointer handler, no ghost.
    const vi_ = el.querySelectorAll<HTMLElement>('.lab-token.is-them')[1];
    tile(vi_).dispatchEvent(pointer('pointerdown', 48, 26));
    el.querySelector('.lab-square')!.dispatchEvent(pointer('pointermove', 60, 60));
    el.querySelector('.lab-square')!.dispatchEvent(pointer('pointerup', 60, 60));
    expect(slidTo(vi_)).toBe('translate(48%, 26%)');
    expect(el.querySelectorAll('.lab-ghost').length).toBe(0);
  });

  it('drags one of ours, leaves a ghost with a line where the minute put them, and reads the new spot', () => {
    const { fixture, el } = mount();
    const square = el.querySelector('.lab-square') as HTMLElement;
    const jinx = ourToken(el, 'Jinx');
    tile(jinx).dispatchEvent(pointer('pointerdown', 62, 87));
    square.dispatchEvent(pointer('pointermove', 20, 80));
    square.dispatchEvent(pointer('pointerup', 20, 80));
    fixture.detectChanges();
    const moved = ourToken(el, 'Jinx');
    expect(slidTo(moved)).toBe('translate(20%, 80%)');
    expect(moved.classList.contains('is-moved')).toBe(true);
    expect(tile(moved).getAttribute('aria-label')).toContain('moved from where the minute put them');
    expect(el.querySelectorAll('.lab-ghost').length).toBe(1);
    expect((el.querySelector('.lab-ghost') as HTMLElement).style.left).toBe('62%');
    const line = el.querySelector('.lab-ghost-line');
    expect(line?.getAttribute('x1')).toBe('62');
    expect(line?.getAttribute('x2')).toBe('20');
    // Deep in our jungle at 14:00 nobody reaches in eight seconds, and no ward sees (the middle of the map is inside their mid's, 1700 units off).
    expect(el.querySelector('.lab-reading')?.textContent).toBe('Out of reach, but nothing sees the way in');
    // Next to their jungler's reach: named by champion, never a name.
    tile(jinx).dispatchEvent(pointer('pointerdown', 20, 80));
    square.dispatchEvent(pointer('pointermove', 49, 27));
    square.dispatchEvent(pointer('pointerup', 49, 27));
    fixture.detectChanges();
    expect(el.querySelector('.lab-reading')?.textContent).toBe("Still inside their Vi's reach");
    // Under our own trinket, far from anyone.
    tile(jinx).dispatchEvent(pointer('pointerdown', 49, 27));
    square.dispatchEvent(pointer('pointermove', 71, 76));
    square.dispatchEvent(pointer('pointerup', 71, 76));
    fixture.detectChanges();
    expect(el.querySelector('.lab-reading')?.textContent).toBe('Out of reach and in sight');
    expect(el.querySelectorAll('.lab-ghost').length).toBe(1);
  });

  it('places a trinket on a tap in Ward mode, adds its sight, changes the reading, and takes it away on a tap', () => {
    const { fixture, el } = mount();
    const square = el.querySelector('.lab-square') as HTMLElement;
    pill(el, 'Ward').click();
    fixture.detectChanges();
    expect(square.classList.contains('is-mode-ward')).toBe(true);
    square.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 49, clientY: 27 }));
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(1);
    expect(el.querySelector('.lab-ward.is-placed svg')?.getAttribute('data-glyph')).toBe('ward');
    expect(el.querySelectorAll('.lab-sight.is-placed').length).toBe(1);
    expect(el.querySelectorAll('.lab-sight').length).toBe(2);
    // Their jungler came from (60, 30), their own jungle, to (48, 26): the ward sits on the way.
    expect(el.querySelector('.lab-reading')?.textContent).toBe("From here, their Vi's path from their jungle would have been in sight");
    pill(el, 'Control ward').click();
    fixture.detectChanges();
    square.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(2);
    expect(el.querySelectorAll('.lab-ward.is-placed.is-control').length).toBe(1);
    expect(el.querySelectorAll('.lab-sight.is-placed.is-control').length).toBe(1);
    // A tap on a placed ward takes it away, and does not put another down under it.
    (el.querySelector('.lab-ward.is-placed') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(1);
    expect(el.querySelectorAll('.lab-ward.is-placed.is-control').length).toBe(1);
    expect(el.querySelector('.lab-reading')?.textContent).toBe('That ward sees none of theirs at this minute');
    // In Move mode a tap on the ground places nothing.
    pill(el, 'Move').click();
    fixture.detectChanges();
    square.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 60 }));
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(1);
  });

  it('draws an arrow of the chosen kind by dragging in Path mode, drops a tap, selects and deletes with the key', () => {
    const { fixture, el } = mount();
    const square = el.querySelector('.lab-square') as HTMLElement;
    pill(el, 'Path').click();
    fixture.detectChanges();
    const kinds = Array.from(el.querySelectorAll<HTMLButtonElement>('.lab-kinds .view-btn')).map((b) => b.textContent?.trim());
    expect(kinds).toEqual(['Move', 'Path', 'Dive']);
    (el.querySelector('.lab-kinds .view-btn.is-dive') as HTMLButtonElement).click();
    fixture.detectChanges();
    square.dispatchEvent(pointer('pointerdown', 20, 20));
    square.dispatchEvent(pointer('pointermove', 40, 40));
    square.dispatchEvent(pointer('pointerup', 40, 40));
    fixture.detectChanges();
    const arrow = el.querySelector('.lab-arrow') as SVGLineElement;
    expect(arrow).toBeTruthy();
    expect(arrow.classList.contains('is-dive')).toBe(true);
    expect(arrow.classList.contains('is-selected')).toBe(true);
    expect(arrow.getAttribute('x2')).toBe('40');
    expect(arrow.getAttribute('marker-end')).toMatch(/^url\(#lab-head-dive-/);
    expect(el.querySelector('marker.lab-arrow-head.is-dive path')?.getAttribute('fill')).toBe('currentColor');
    // A tap is no arrow, and it leaves the selection where it was.
    square.dispatchEvent(pointer('pointerdown', 60, 60));
    square.dispatchEvent(pointer('pointerup', 60, 60));
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-arrow').length).toBe(1);
    expect(el.querySelector('.lab-arrow')?.classList.contains('is-selected')).toBe(true);
    // Delete takes the selected arrow away; Undo brings it back.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-arrow').length).toBe(0);
    pill(el, 'Undo').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-arrow').length).toBe(1);
  });

  it('emits the drawing on Save, with the second, the moves, the wards and the arrows', () => {
    const { fixture, el } = mount();
    const square = el.querySelector('.lab-square') as HTMLElement;
    const onSave = vi.fn<(d: FilmLabDrawing) => void>();
    fixture.componentInstance.save.subscribe(onSave);
    expect(pill(el, 'Save').disabled).toBe(true);
    tile(ourToken(el, 'Jinx')).dispatchEvent(pointer('pointerdown', 62, 87));
    square.dispatchEvent(pointer('pointermove', 50, 50));
    square.dispatchEvent(pointer('pointerup', 50, 50));
    pill(el, 'Ward').click();
    fixture.detectChanges();
    square.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 49, clientY: 27 }));
    pill(el, 'Path').click();
    fixture.detectChanges();
    square.dispatchEvent(pointer('pointerdown', 20, 20));
    square.dispatchEvent(pointer('pointermove', 40, 40));
    square.dispatchEvent(pointer('pointerup', 40, 40));
    fixture.detectChanges();
    expect(pill(el, 'Save').disabled).toBe(false);
    pill(el, 'Save').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({
      sec: 840,
      moved: [{ seat: 'ADC', x: 50, y: 50 }],
      wards: [{ type: 'trinket', x: 49, y: 27 }],
      arrows: [{ x1: 20, y1: 20, x2: 40, y2: 40, kind: 'path' }]
    });
    expect(fixture.componentInstance.readingLine()).toBe("From here, their Vi's path from their jungle would have been in sight");
  });

  it('resets to the frame, and Undo steps back through it', () => {
    const { fixture, el } = mount();
    const square = el.querySelector('.lab-square') as HTMLElement;
    expect(pill(el, 'Reset').disabled).toBe(true);
    expect(pill(el, 'Undo').disabled).toBe(true);
    tile(ourToken(el, 'Jinx')).dispatchEvent(pointer('pointerdown', 62, 87));
    square.dispatchEvent(pointer('pointermove', 50, 50));
    square.dispatchEvent(pointer('pointerup', 50, 50));
    pill(el, 'Ward').click();
    fixture.detectChanges();
    square.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 30, clientY: 30 }));
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ghost').length).toBe(1);
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(1);
    pill(el, 'Reset').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ghost').length).toBe(0);
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(0);
    expect(slidTo(ourToken(el, 'Jinx'))).toBe('translate(62%, 87%)');
    expect(pill(el, 'Reset').disabled).toBe(true);
    // Undo after a Reset brings the drawing back, then steps back through it.
    pill(el, 'Undo').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ghost').length).toBe(1);
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(1);
    pill(el, 'Undo').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ward.is-placed').length).toBe(0);
    expect(el.querySelectorAll('.lab-ghost').length).toBe(1);
    pill(el, 'Undo').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-ghost').length).toBe(0);
    expect(pill(el, 'Undo').disabled).toBe(true);
  });

  it('closes on Escape and on the Close pill, and caps the death marks', () => {
    const { fixture, el } = mount({ deaths: Array.from({ length: 14 }, (_, i) => ({ ...pin, key: `d:${i}:ADC`, sec: 840 + i })) });
    const onClose = vi.fn();
    fixture.componentInstance.close.subscribe(onClose);
    expect(el.querySelectorAll('.lab-death').length).toBe(MAX_LAB_DEATHS);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    pill(el, 'Close').click();
    expect(onClose).toHaveBeenCalledTimes(2);
    // Every action is a pill, never a link.
    expect(el.querySelectorAll('a').length).toBe(0);
    for (const b of Array.from(el.querySelectorAll('.lab-tools button'))) expect(b.classList.contains('view-btn')).toBe(true);
  });

  it('offers Save to an editor only: a viewer gets the lab, the reading and Close, and no pill that would write', () => {
    const editor = mount();
    expect(pill(editor.el, 'Save')).toBeTruthy();
    const viewer = mount({ canSave: false });
    // The toolbar's own pills; the marks legend hangs its pill in its own element, so it is asserted separately below.
    expect(Array.from(viewer.el.querySelectorAll('.lab-tools > .view-btn')).map((b) => b.textContent?.trim())).toEqual(['Move', 'Ward', 'Control ward', 'Path', 'Undo', 'Reset', 'Close']);
    expect(viewer.el.querySelector('.lab-reading')).not.toBeNull();
    // What the marks mean is a reader's pill, not an editor's: a viewer gets it too (11 Sep 2026).
    expect(viewer.el.querySelector('.lab-tools app-mark-legend .mark-legend-btn')).not.toBeNull();
  });

  it('stands on the first frame without a previous one: every reach at the floor', () => {
    const { el } = mount({ previous: null, wards: [], deaths: [] });
    const radii = Array.from(el.querySelectorAll('.lab-reach')).map((c) => Number(c.getAttribute('r')));
    expect(radii.length).toBe(5);
    expect(new Set(radii.map((r) => r.toFixed(3))).size).toBe(1);
    expect(el.querySelectorAll('.lab-sight').length).toBe(0);
    expect(el.querySelectorAll('.lab-cell.is-safe').length).toBe(0);
  });

  it('reads their pace off the real gap between the two frames: eight seconds on foot until the pace beats a walk, further then', () => {
    const reachOfVi = (el: HTMLElement) => Number(el.querySelector('.lab-reach[data-seat="Jungle"]')?.getAttribute('r'));
    const minute = reachOfVi(mount().el);
    // Vi came 1950 units in a minute, and in half a minute: under a walk both ways, so the walking floor both times.
    const half = reachOfVi(mount({ frame: { ...frame, minute: 13.5 }, sec: 810 }).el);
    expect(half).toBe(minute);
    // The same ground in three seconds is a dash: the circle grows past the floor.
    const dash = reachOfVi(mount({ frame: { ...frame, minute: 13.05 }, sec: 783 }).el);
    expect(dash).toBeGreaterThan(minute);
    // The same frame twice is no pace at all: the floor, not a division by nothing.
    const same = reachOfVi(mount({ previous: { ...previous, minute: 14 } }).el);
    expect(Number.isFinite(same)).toBe(true);
    expect(same).toBe(minute);
  });

  it('opens on the board the film keeps for the second, with Save asleep until the board changes, and hands back an empty board after Reset (10 Sep 2026, second fix pass)', () => {
    const saved: FilmLabDrawing = {
      sec: 840,
      moved: [{ seat: 'ADC', x: 20, y: 80 }],
      wards: [{ type: 'control', x: 49, y: 27 }],
      arrows: [{ x1: 20, y1: 20, x2: 40, y2: 40, kind: 'dive' }]
    };
    const { fixture, el } = mount({ saved });
    const onSave = vi.fn<(d: FilmLabDrawing) => void>();
    fixture.componentInstance.save.subscribe(onSave);
    // The board is there: the moved token with its ghost, the placed ward with its sight, the arrow in its kind.
    expect(slidTo(ourToken(el, 'Jinx'))).toBe('translate(20%, 80%)');
    expect(el.querySelectorAll('.lab-ghost').length).toBe(1);
    expect(el.querySelectorAll('.lab-ward.is-placed.is-control').length).toBe(1);
    expect(el.querySelectorAll('.lab-arrow.is-dive').length).toBe(1);
    expect(el.querySelector('.lab-arrow')?.getAttribute('x2')).toBe('40');
    // Nothing differs from the saved board yet: Save sleeps, Reset and Undo read the board.
    expect(pill(el, 'Save').disabled).toBe(true);
    expect(pill(el, 'Reset').disabled).toBe(false);
    expect(pill(el, 'Undo').disabled).toBe(true);
    // A change wakes Save; the drawing handed over carries the saved board plus the change.
    const square = el.querySelector('.lab-square') as HTMLElement;
    pill(el, 'Ward').click();
    fixture.detectChanges();
    square.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 70, clientY: 60 }));
    fixture.detectChanges();
    expect(pill(el, 'Save').disabled).toBe(false);
    pill(el, 'Save').click();
    expect(onSave.mock.calls[0][0]).toEqual({ ...saved, wards: [...saved.wards, { type: 'trinket', x: 70, y: 60 }] });
    // Undo back to the saved board: Save sleeps again.
    pill(el, 'Undo').click();
    fixture.detectChanges();
    expect(pill(el, 'Save').disabled).toBe(true);
    // Reset clears the board; Save then hands back an empty one, for the host to take the note off.
    pill(el, 'Reset').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.lab-arrow').length).toBe(0);
    expect(el.querySelectorAll('.lab-ghost').length).toBe(0);
    expect(pill(el, 'Save').disabled).toBe(false);
    pill(el, 'Save').click();
    expect(onSave.mock.calls[1][0]).toEqual({ sec: 840, moved: [], wards: [], arrows: [] });
    // A drawn arrow never shares an id with a seeded one: both stand and both can be selected.
    const again = mount({ saved }).el;
    expect(again.querySelectorAll('.lab-arrow').length).toBe(1);
    // Without a saved board the lab opens bare, as before.
    const bare = mount().el;
    expect(bare.querySelectorAll('.lab-arrow').length).toBe(0);
    expect(pill(bare, 'Reset').disabled).toBe(true);
  });
});
