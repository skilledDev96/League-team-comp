import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmModel, FilmStrip, FilmStripMoment, FilmStripRow } from '../../../core/film-model';
import { styleFor } from '../../../core/film-style';
import { ReplayShot, Role } from '../../../models/team.models';
import { ReplayRecordingService } from '../../../services/replay-recording.service';
import { downLine, FilmStripComponent } from './film-strip.component';

// Local mode, the way the film page's spec does it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const ID = 'EUW1-7977592156';

/** Ours by seat, with the names the recording carries; theirs is a champion in a seat and carries none, because none is stored. */
const ours: [Role, string, string][] = [
  ['Top', 'Ornn', 'Ruan'],
  ['Jungle', 'Trundle', 'Go10x'],
  ['Mid', 'Orianna', 'Kai'],
  ['ADC', 'Jinx', 'Rhu'],
  ['Support', 'Leona', 'Nia']
];
const theirs: [Role, string][] = [
  ['Top', 'Sett'],
  ['Jungle', 'LeeSin'],
  ['Mid', 'Ahri'],
  ['ADC', 'Caitlyn'],
  ['Support', 'Thresh']
];

/** The ten at a death of ours: our ADC is the seat that fell, their Support was already down. */
const board: FilmStripRow[] = [
  ...ours.map(([seat, champion, name]) => {
    const row: FilmStripRow = { seat, ours: true, champion, name, level: 9, cs: 118, items: ['Kraken Slayer', "Berserker's Greaves"] };
    if (seat === 'ADC') row.victim = true;
    return row;
  }),
  ...theirs.map(([seat, champion]) => {
    const row: FilmStripRow = { seat, ours: false, champion, level: 10, cs: 131, items: [] };
    if (seat === 'Support') {
      row.dead = true;
      row.respawn = 11.6;
    }
    return row;
  })
];

const moments: FilmStripMoment[] = [
  {
    key: 's:320',
    sec: 320,
    minute: 5,
    clock: '5:20',
    kind: 'death',
    seat: 'ADC',
    label: 'Rhu (Jinx) falls at 5:20',
    frames: [`${ID}__320__2`, `${ID}__320__1`, `${ID}__320`],
    board,
    line: 'Minute 5: our ADC fell, holding Kraken Slayer; level 9, 118 cs; already down: their Support (12s left).'
  },
  {
    key: 's:540',
    sec: 540,
    minute: 9,
    clock: '9:00',
    kind: 'death',
    seat: 'Support',
    label: 'Nia (Leona) falls at 9:00',
    frames: [`${ID}__540__2`, `${ID}__540__1`, `${ID}__540`],
    board,
    line: 'Minute 9: our Support fell.'
  },
  { key: 's:940', sec: 940, minute: 15, clock: '15:40', kind: 'objective', label: 'Their baron at 15:40', frames: [`${ID}__940`] }
];

const strip: FilmStrip = {
  moments,
  recordedOn: '2026-09-12T18:20:00.000Z',
  opening: 'Twenty deaths, three frames on the eight that mattered.',
  caveat: 'Every board is what the client showed two seconds before the death it belongs to.',
  boards: true,
  pictures: true
};

function modelWith(s: FilmStrip | undefined): FilmModel {
  return {
    matchId: ID,
    tier: 'endOfGame',
    seed: 7,
    style: styleFor(7, false),
    chapters: [],
    seats: ours.map(([seat, champion, name]) => ({ seat, champion, name })),
    title: { headline: 'Bled 35 kills', win: false, protagonist: { seat: 'ADC', champion: 'Jinx', name: 'Rhu' }, lowerThird: { date: 0, compName: null, compVerdict: 'off plan', compWhy: '', tier: 'endOfGame' } },
    strip: s
  } as unknown as FilmModel;
}

const picture = (docId: string) => ({ matchId: ID, sec: 320, kind: 'death', label: 'A frame', mediaType: 'image/jpeg', bytes: 210_000, data: `BASE64-${docId}` }) as unknown as ReplayShot;

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function key(name: string, shift = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey: shift }));
}

describe('the strip row wording', () => {
  it('says the respawn with its terms, and says only "Down" when the client gave no seconds', () => {
    expect(downLine({ seat: 'Support', ours: false, champion: 'Thresh', level: 10, cs: 1, items: [], dead: true, respawn: 11.6 })).toBe('Down, 12s to respawn');
    expect(downLine({ seat: 'Support', ours: false, champion: 'Thresh', level: 10, cs: 1, items: [], dead: true })).toBe('Down');
  });
});

/**
 * The frames chapter, and what it costs. A recording can carry twenty moments
 * and sixty frames of a few hundred kilobytes each, so the whole design is in
 * the reads: none at all while the chapter is off stage, the moment's own
 * frames and the next moment's picture when it comes up, and never a second
 * read of a document the session already holds.
 */
// The chapter renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('FilmStripComponent', () => {
  const knownShots = signal<ReadonlyMap<string, ReplayShot | null>>(new Map());
  let loadShot: ReturnType<typeof vi.fn>;
  /** The documents the stub answers `null` for: a frame the run wrote and something has since removed. */
  let missing: Set<string>;

  beforeEach(() => {
    localStorage.clear();
    // Motion off, as the film's own pill would set it: the rows stand at their place instead of rising over frames jsdom does not draw.
    localStorage.setItem('bom-motion', 'off');
    knownShots.set(new Map());
    missing = new Set();
    loadShot = vi.fn(async (docId: string) => {
      const shot = missing.has(docId) ? null : picture(docId);
      knownShots.update((m) => new Map(m).set(docId, shot));
      return shot;
    });
    const stub = {
      known: signal<ReadonlyMap<string, unknown>>(new Map()),
      knownShots,
      load: vi.fn(async () => null),
      loadShot,
      recordingFor: () => undefined,
      shotFor: (docId: string) => knownShots().get(docId),
      has: () => false
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ReplayRecordingService, useValue: stub }] });
  });

  /** `null` is a film with no recording at all; the default is the three-moment one above. */
  function mount(active = true, s: FilmStrip | null = strip): { fixture: ComponentFixture<FilmStripComponent>; root: HTMLElement } {
    const fixture = TestBed.createComponent(FilmStripComponent);
    fixture.componentRef.setInput('model', modelWith(s ?? undefined));
    fixture.componentRef.setInput('active', active);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  const asked = (): string[] => loadShot.mock.calls.map((c) => String(c[0]));
  const steps = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('.film-strip-steps .view-btn'));
  const chips = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('.film-strip-chip'));

  it('reads nothing at all while the chapter is off stage', () => {
    const { root } = mount(false);
    expect(loadShot).not.toHaveBeenCalled();
    // The chapter still draws itself — on a phone the deck holds every chapter — and says why there is no picture yet.
    expect(text(root.querySelector('.film-strip-clock'))).toBe('5:20');
    expect(text(root.querySelector('.film-strip-words'))).toBe('Rhu (Jinx) falls at 5:20');
    expect(root.querySelector('.replay-shot-img')).toBeNull();
    expect(text(root.querySelector('.replay-shot-note'))).toContain('read once this chapter comes up');
  });

  it('reads the moment on stage and the next moment\'s own picture when it comes up, and nothing else', () => {
    const { fixture, root } = mount(false);
    expect(loadShot).not.toHaveBeenCalled();
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    // The three frames of this moment, and one frame ahead: the next moment's picture, never its run-up.
    expect(asked().sort()).toEqual([`${ID}__320`, `${ID}__320__1`, `${ID}__320__2`, `${ID}__540`].sort());
    expect(loadShot).toHaveBeenCalledTimes(4);
    // What is shown is the moment itself; the run-up is stepped back into.
    const shown = root.querySelector<HTMLImageElement>('.film-strip-shot.is-shown .replay-shot-img');
    expect(shown?.getAttribute('src')).toBe(`data:image/jpeg;base64,BASE64-${ID}__320`);
    expect(root.querySelectorAll('.film-strip-shot.is-shown')).toHaveLength(1);
    expect(steps(root).map((b) => text(b))).toEqual(['-2s', '-1s', 'now']);
    expect(steps(root)[2].classList.contains('active')).toBe(true);
    expect(text(root.querySelector('.film-strip-steps-label'))).toBe('Seconds before');
  });

  it('names each step by the seconds in its own document id, not by where it sits in the strip', () => {
    // The recorder spreads the run-up across `SHOT_LEAD_SEC` (8) seconds, one frame every two, and
    // writes the true figure into the id as `{matchId}__{sec}__{frame}`. Counting the step off the
    // index instead read "-4s -3s -2s -1s now" over pictures genuinely eight, six, four and two
    // seconds before the death — four labels, every one of them wrong (12 Sep 2026).
    const spread = { ...moments[0], frames: [`${ID}__320__8`, `${ID}__320__6`, `${ID}__320__4`, `${ID}__320__2`, `${ID}__320`] };
    const { root } = mount(true, { ...strip, moments: [spread, moments[2]] });
    expect(steps(root).map((b) => text(b))).toEqual(['-8s', '-6s', '-4s', '-2s', 'now']);
    // And the same figure in the words a reader who cannot see the picture gets.
    expect(Array.from(root.querySelectorAll<HTMLImageElement>('.film-strip-shots .replay-shot-img')).map((i) => i.getAttribute('alt'))).toEqual([
      'Rhu (Jinx) falls at 5:20, 8 seconds before',
      'Rhu (Jinx) falls at 5:20, 6 seconds before',
      'Rhu (Jinx) falls at 5:20, 4 seconds before',
      'Rhu (Jinx) falls at 5:20, 2 seconds before',
      'Rhu (Jinx) falls at 5:20'
    ]);
    expect(steps(root)[4].classList.contains('active')).toBe(true);
  });

  it('steps the frames of the moment without reading anything again, by pill and by arrow', () => {
    const { fixture, root } = mount();
    const first = loadShot.mock.calls.length;
    steps(root)[0].click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLImageElement>('.film-strip-shot.is-shown .replay-shot-img')?.getAttribute('src')).toBe(`data:image/jpeg;base64,BASE64-${ID}__320__2`);
    key('ArrowRight');
    fixture.detectChanges();
    expect(steps(root)[1].classList.contains('active')).toBe(true);
    key('ArrowLeft');
    key('ArrowLeft');
    fixture.detectChanges();
    // Clamped at the earliest frame: the arrows step this moment and never walk into the one before it.
    expect(steps(root)[0].classList.contains('active')).toBe(true);
    expect(loadShot).toHaveBeenCalledTimes(first);
  });

  it('walks to the next moment without re-reading the picture it read ahead', () => {
    const { fixture, root } = mount();
    loadShot.mockClear();
    chips(root)[1].click();
    fixture.detectChanges();
    // The moment's own picture is already in hand, so only its run-up and the next moment's picture are read.
    expect(asked().sort()).toEqual([`${ID}__540__1`, `${ID}__540__2`, `${ID}__940`].sort());
    expect(asked()).not.toContain(`${ID}__540`);
    // And it opens on the moment, not two seconds early.
    expect(steps(root)[2].classList.contains('active')).toBe(true);
    expect(text(root.querySelector('.film-strip-words'))).toBe('Nia (Leona) falls at 9:00');
  });

  it('says so when the document is gone, rather than drawing a broken picture', async () => {
    missing.add(`${ID}__320`);
    const { fixture, root } = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    const shown = root.querySelector('.film-strip-shot.is-shown')!;
    expect(shown.querySelector('img')).toBeNull();
    expect(text(shown.querySelector('.replay-shot-note'))).toBe('That frame is not stored any more.');
    // The frames beside it are unaffected: stepping back still shows the run-up.
    steps(root)[0].click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLImageElement>('.film-strip-shot.is-shown .replay-shot-img')?.getAttribute('src')).toBe(`data:image/jpeg;base64,BASE64-${ID}__320__2`);
  });

  it('puts a stepped strip back on its moment on Escape, and says nothing when there was nothing to put back', () => {
    const { fixture, root } = mount();
    let escaped = 0;
    fixture.componentInstance.escaped.subscribe(() => escaped++);
    // A press with the strip already on its moment is not this chapter's to answer.
    fixture.componentRef.setInput('closeTick', 1);
    fixture.detectChanges();
    expect(escaped).toBe(0);
    steps(root)[0].click();
    fixture.detectChanges();
    expect(steps(root)[0].classList.contains('active')).toBe(true);
    fixture.componentRef.setInput('closeTick', 2);
    fixture.detectChanges();
    expect(steps(root)[2].classList.contains('active')).toBe(true);
    expect(escaped).toBe(1);
    // And the next press finds nothing, so the page's second Escape leaves the film.
    fixture.componentRef.setInput('closeTick', 3);
    fixture.detectChanges();
    expect(escaped).toBe(1);
  });

  it('draws no stepper for a moment the run kept one picture of, and says that is what it kept', () => {
    const { fixture, root } = mount();
    chips(root)[2].click();
    fixture.detectChanges();
    expect(root.querySelector('.film-strip-steps')).toBeNull();
    expect(text(root.querySelector('.film-strip-steps-one'))).toBe('This recording kept one picture a moment.');
    expect(root.querySelectorAll('.film-strip-shot')).toHaveLength(1);
    // An objective has no board of ours to read, and the column says which rather than standing empty.
    expect(root.querySelector('.film-strip-board')).toBeNull();
    expect(text(root.querySelector('.film-strip-side .film-strip-none'))).toBe('The recorder reads the board at a death of ours, and this moment is not one.');
  });

  it('puts all ten beside the frame, ours first, the seat that fell ringed and the one already down dimmed with their respawn', () => {
    const { root } = mount();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.film-strip-row'));
    expect(rows).toHaveLength(10);
    expect(rows.slice(0, 5).every((r) => r.classList.contains('is-ours'))).toBe(true);
    expect(rows.slice(5).some((r) => r.classList.contains('is-ours'))).toBe(false);
    // Ours by name, theirs by seat: the other team is a champion in a seat and no name of theirs is stored to print.
    expect(rows.map((r) => text(r.querySelector('.film-strip-who b')))).toEqual(['Ruan', 'Go10x', 'Kai', 'Rhu', 'Nia', 'Their Top', 'Their Jungle', 'Their Mid', 'Their ADC', 'Their Support']);
    const victim = rows[3];
    expect(victim.classList.contains('is-victim')).toBe(true);
    expect(text(victim.querySelector('.film-strip-fell'))).toBe('Fell here');
    // Every figure carries its terms.
    expect(Array.from(victim.querySelectorAll('.film-strip-figs b')).map((b) => text(b))).toEqual(['9', '118']);
    expect(Array.from(victim.querySelectorAll('.film-strip-figs small')).map((b) => text(b))).toEqual(['level', 'CS']);
    expect(Array.from(victim.querySelectorAll('.film-strip-item')).map((i) => text(i))).toEqual(['Kraken Slayer', "Berserker's Greaves"]);
    const down = rows[9];
    expect(down.classList.contains('is-down')).toBe(true);
    expect(text(down.querySelector('.film-strip-down'))).toBe('Down, 12s to respawn');
    expect(text(down.querySelector('.film-strip-item.is-none'))).toBe('Nothing');
    // The death's own sentence and the one caveat that covers the whole strip.
    expect(text(root.querySelector('.film-strip-line'))).toBe(moments[0].line!);
    expect(text(root.querySelector('.film-strip-caveat'))).toBe(strip.caveat);
    expect(text(root.querySelector('.film-strip-opening'))).toBe(strip.opening);
    expect(text(root.querySelector('.film-strip-when'))).toMatch(/Recorded on 12 Sept? 2026\./);
  });

  it('names nobody on the other side anywhere on the chapter', () => {
    const { root } = mount();
    const printed = text(root);
    for (const name of ['Rhu', 'Ruan']) expect(printed).toContain(name);
    // Nothing of theirs to print: the recording stores a seat and a champion and no name, and the rows must not invent one.
    for (const row of Array.from(root.querySelectorAll('.film-strip-row')).slice(5)) {
      expect(text(row.querySelector('.film-strip-who b')).startsWith('Their ')).toBe(true);
    }
  });

  it('degrades honestly: no pictures at all, and a recording made before the boards', () => {
    const noPictures = mount(true, { ...strip, pictures: false });
    expect(text(noPictures.root.querySelector('.film-strip-stage .film-strip-none'))).toBe('The recorder kept no frames of this game, so there is nothing to look at — only the boards and the lines beside them.');
    expect(noPictures.root.querySelector('.film-strip-shots')).toBeNull();
    expect(noPictures.root.querySelectorAll('.film-strip-row')).toHaveLength(10);

    const noBoards = mount(true, { ...strip, boards: false, moments: moments.map((m) => ({ ...m, board: undefined })) });
    expect(text(noBoards.root.querySelector('.film-strip-side .film-strip-none'))).toBe('This game was recorded before the boards were kept, so what the ten were holding is only what the picture shows.');
    expect(noBoards.root.querySelector('.film-strip-board')).toBeNull();
    expect(noBoards.root.querySelector('.film-strip-shots')).not.toBeNull();
  });

  it('walks the moments with Shift and an arrow, the way the tape does', () => {
    const { fixture, root } = mount();
    key('ArrowRight', true);
    fixture.detectChanges();
    expect(text(root.querySelector('.film-strip-words'))).toBe('Nia (Leona) falls at 9:00');
    expect(chips(root)[1].classList.contains('is-current')).toBe(true);
    key('ArrowLeft', true);
    fixture.detectChanges();
    expect(chips(root)[0].classList.contains('is-current')).toBe(true);
  });

  it('says so when the review carries no recording at all', () => {
    const { root } = mount(true, null);
    expect(text(root.querySelector('.film-wait'))).toBe('No recording for this game, so there are no frames.');
    expect(loadShot).not.toHaveBeenCalled();
  });
});
