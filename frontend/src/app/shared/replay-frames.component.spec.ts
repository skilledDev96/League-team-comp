import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayRecording, ReplayShot } from '../models/team.models';
import { ReplayRecordingService } from '../services/replay-recording.service';
import { ReplayFramesComponent } from './replay-frames.component';

/**
 * The strip of frames on a recorded game's drawer. What matters here is what
 * it costs: nothing at all while the drawer is shut, one read of the
 * recording when it opens, and one read a picture — on a tap, since jsdom
 * has no IntersectionObserver and the scroll-into-view road cannot run.
 */

const ID = 'EUW1-7977592156';

const shots = [
  { sec: 320, kind: 'death', label: 'Jinx falls in the river', seat: 'ADC', docId: `${ID}__320` },
  { sec: 940, kind: 'objective', label: 'Their baron', docId: `${ID}__940` },
  { sec: 1810, kind: 'end', label: 'The last fight', docId: `${ID}__1810` }
];

const recording = {
  matchId: ID,
  recordedAt: '2026-09-10T18:20:00.000Z',
  recorderVersion: 1,
  durationSec: 1860,
  ourSide: 'blue',
  seats: [],
  samples: [],
  events: [],
  shots,
  bytes: 4200
} as unknown as ReplayRecording;

const picture = (docId: string) =>
  ({ matchId: ID, sec: 320, kind: 'death', label: 'Jinx falls in the river', mediaType: 'image/jpeg', bytes: 210_000, data: `BASE64-${docId}` }) as unknown as ReplayShot;

describe('ReplayFramesComponent', () => {
  const known = signal<ReadonlyMap<string, ReplayRecording | null>>(new Map());
  const knownShots = signal<ReadonlyMap<string, ReplayShot | null>>(new Map());
  let load: ReturnType<typeof vi.fn>;
  let loadShot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Closing the lightbox puts the focus back on the thumbnail, which carries a
    // tooltip, and the tooltip is a popover jsdom does not implement.
    const el = HTMLElement.prototype as unknown as { showPopover?: () => void; hidePopover?: () => void };
    el.showPopover ??= () => undefined;
    el.hidePopover ??= () => undefined;
    known.set(new Map());
    knownShots.set(new Map());
    load = vi.fn(async (matchId: string) => {
      known.update((m) => new Map(m).set(matchId, recording));
      return recording;
    });
    loadShot = vi.fn(async (docId: string) => {
      knownShots.update((m) => new Map(m).set(docId, picture(docId)));
      return picture(docId);
    });
    const stub = {
      known,
      knownShots,
      load,
      loadShot,
      recordingFor: (id: string | undefined) => (id ? known().get(id) : undefined),
      shotFor: (docId: string) => knownShots().get(docId),
      has: (id: string | undefined) => !!(id && known().get(id))
    };
    TestBed.configureTestingModule({ providers: [{ provide: ReplayRecordingService, useValue: stub }] });
  });

  function mount(open = true): ComponentFixture<ReplayFramesComponent> {
    const fixture = TestBed.createComponent(ReplayFramesComponent);
    fixture.componentRef.setInput('matchId', ID);
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    return fixture;
  }

  const el = (fixture: ComponentFixture<ReplayFramesComponent>) => fixture.nativeElement as HTMLElement;
  const thumbs = (fixture: ComponentFixture<ReplayFramesComponent>) => Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.rf-shot'));

  it('reads nothing while the row is shut', () => {
    const fixture = mount(false);
    expect(load).not.toHaveBeenCalled();
    expect(el(fixture).querySelector('.replay-frames')).toBeNull();
  });

  it('reads the recording once when the row opens, and draws a thumbnail a frame with its minute and label', () => {
    const fixture = mount();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(ID);
    // The day is the browser's own short form, the way every other date on the Games page is written ("Sep" or "Sept" by runtime).
    expect(el(fixture).querySelector('.rf-note')?.textContent).toMatch(/Frames from the replay, recorded on 10 Sept? 2026/);
    expect(el(fixture).querySelector('.rf-note')?.textContent).toContain('positions are what the minimap shows');
    expect(thumbs(fixture).length).toBe(3);
    expect(thumbs(fixture).map((b) => b.querySelector('.rf-when')?.textContent?.trim())).toEqual(['5 min', '15 min', '30 min']);
    expect(thumbs(fixture).map((b) => b.querySelector('.rf-label')?.textContent?.trim())).toEqual(['Jinx falls in the river', 'Their baron', 'The last fight']);
    // Nothing that costs a few hundred kilobytes has been read: no picture, no img.
    expect(loadShot).not.toHaveBeenCalled();
    expect(el(fixture).querySelectorAll('.rf-thumb-img').length).toBe(0);
  });

  it('loads one picture on a tap and opens it large, and never reads the same one twice', async () => {
    const fixture = mount();
    thumbs(fixture)[1].click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(loadShot).toHaveBeenCalledTimes(1);
    expect(loadShot).toHaveBeenCalledWith(`${ID}__940`);
    const big = el(fixture).querySelector<HTMLImageElement>('.rf-light-img');
    expect(big?.getAttribute('src')).toBe(`data:image/jpeg;base64,BASE64-${ID}__940`);
    expect(el(fixture).querySelector('.rf-light-label')?.textContent).toContain('15 min');
    // The thumbnail it was opened from now has the same picture, from the one read.
    expect(el(fixture).querySelectorAll('.rf-thumb-img').length).toBe(1);

    thumbs(fixture)[1].click();
    await fixture.whenStable();
    expect(loadShot).toHaveBeenCalledTimes(1);
  });

  it('steps with the pills and the arrows, and closes on the pill and on Escape', async () => {
    const fixture = mount();
    thumbs(fixture)[0].click();
    await fixture.whenStable();
    fixture.detectChanges();

    const pill = (word: string) => Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.rf-light-actions .view-btn')).find((b) => b.textContent?.includes(word))!;
    expect(pill('Earlier').disabled).toBe(true);
    pill('Later').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el(fixture).querySelector('.rf-light-label')?.textContent).toContain('15 min');
    expect(loadShot).toHaveBeenCalledTimes(2);

    // The arrows step the same way, on the component's own keydown.
    el(fixture).querySelector<HTMLElement>('.rf-light')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el(fixture).querySelector('.rf-light-label')?.textContent).toContain('30 min');

    el(fixture).querySelector<HTMLElement>('.rf-light')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el(fixture).querySelector('.rf-light')).toBeNull();

    thumbs(fixture)[0].click();
    await fixture.whenStable();
    fixture.detectChanges();
    pill('Close').click();
    fixture.detectChanges();
    expect(el(fixture).querySelector('.rf-light')).toBeNull();
  });

  it('says so when the recorder kept no frames', () => {
    known.set(new Map([[ID, { ...recording, shots: [] }]]));
    const fixture = mount();
    expect(el(fixture).querySelector('.rf-strip')).toBeNull();
    expect(el(fixture).textContent).toContain('The recorder kept no frames of this game.');
  });

  // The service casts the Firestore snapshot straight through, and both api
  // readers guard the same field: a half-written or hand-edited document with
  // no `shots` used to take the whole Games row down with a TypeError.
  it('draws nothing rather than throwing on a recording with no shots at all', () => {
    const { shots: _gone, ...withoutShots } = recording as unknown as Record<string, unknown>;
    known.set(new Map([[ID, withoutShots as unknown as ReplayRecording]]));
    const fixture = mount();
    expect(el(fixture).querySelector('.rf-strip')).toBeNull();
    expect(el(fixture).textContent).toContain('The recorder kept no frames of this game.');
  });

  // An inline detail panel in the row's flow, not a modal: nothing outside it
  // is inert and Tab walks straight out, so aria-modal would tell a screen
  // reader the opposite of what is true.
  it('opens the frame as a labelled dialog and never claims to be modal', async () => {
    const fixture = mount();
    thumbs(fixture)[0].click();
    await fixture.whenStable();
    fixture.detectChanges();
    const light = el(fixture).querySelector<HTMLElement>('.rf-light')!;
    expect(light.getAttribute('role')).toBe('dialog');
    expect(light.hasAttribute('aria-modal')).toBe(false);
    expect(light.getAttribute('aria-label')).toContain('Frame at 5 minutes');
  });
});
