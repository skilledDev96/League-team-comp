// @vitest-environment jsdom
import { DestroyRef } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilmClock, FilmClock } from './film-clock';

/** Frames as 16 ms timers so fake time drives them, with a real timestamp so the clock's own reading agrees. */
function stubFrames(): { requests: number; cancels: number } {
  const stats = { requests: 0, cancels: 0 };
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    stats.requests++;
    return setTimeout(() => cb(performance.now()), 16) as unknown as number;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    stats.cancels++;
    clearTimeout(id);
  });
  return stats;
}

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('createFilmClock', () => {
  let clocks: FilmClock[];
  let frames: { requests: number; cancels: number };
  const make = (opts: Partial<Parameters<typeof createFilmClock>[0]> = {}): FilmClock => {
    const c = createFilmClock({ durationSec: 1800, ...opts });
    clocks.push(c);
    return c;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    frames = stubFrames();
    clocks = [];
  });

  afterEach(() => {
    clocks.forEach((c) => c.destroy());
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('starts at zero, paused, with the duration', () => {
    const c = make();
    expect(c.t()).toBe(0);
    expect(c.playing()).toBe(false);
    expect(c.durationSec).toBe(1800);
    expect(frames.requests).toBe(0);
  });

  it('advances game time at 1.2 real seconds per game minute while playing', () => {
    const c = make();
    c.play();
    expect(c.playing()).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(c.t()).toBeCloseTo(60, 6);
    vi.advanceTimersByTime(640);
    expect(c.t()).toBeCloseTo(92, 6);
  });

  it('honours a rate given up front and one set later', () => {
    const c = make({ secPerGameMinute: 0.6 });
    c.play();
    vi.advanceTimersByTime(640);
    expect(c.t()).toBeCloseTo(64, 6);
    c.setRate(2.4);
    vi.advanceTimersByTime(2400);
    expect(c.t()).toBeCloseTo(124, 6);
    c.setRate(0);
    vi.advanceTimersByTime(240);
    expect(c.t()).toBeCloseTo(130, 6);
  });

  it('holds on pause and asks for no frames while paused', () => {
    const c = make();
    c.play();
    vi.advanceTimersByTime(320);
    c.pause();
    const held = c.t();
    const asked = frames.requests;
    expect(c.playing()).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(c.t()).toBe(held);
    expect(frames.requests).toBe(asked);
    c.toggle();
    expect(c.playing()).toBe(true);
    vi.advanceTimersByTime(160);
    expect(c.t()).toBeCloseTo(held + 8, 6);
    c.toggle();
    expect(c.playing()).toBe(false);
  });

  it('seeks, clamped to the game, without jumping when played on', () => {
    const c = make();
    c.seek(600);
    expect(c.t()).toBe(600);
    c.seek(-40);
    expect(c.t()).toBe(0);
    c.seek(99999);
    expect(c.t()).toBe(1800);
    c.seek(300);
    c.play();
    vi.advanceTimersByTime(3008);
    c.seek(60);
    vi.advanceTimersByTime(160);
    expect(c.t()).toBeCloseTo(68, 6);
  });

  it('steps by whole minutes either way, clamped', () => {
    const c = make();
    c.step(1);
    expect(c.t()).toBe(60);
    c.step(5);
    expect(c.t()).toBe(360);
    c.step(-2);
    expect(c.t()).toBe(240);
    c.step(-10);
    expect(c.t()).toBe(0);
    c.step(100);
    expect(c.t()).toBe(1800);
  });

  it('stops at the end and fires onEnd once', () => {
    const onEnd = vi.fn();
    const c = make({ durationSec: 120, onEnd });
    c.play();
    vi.advanceTimersByTime(2400);
    expect(c.t()).toBe(120);
    expect(c.playing()).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    c.seek(120);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('fires onEnd again only after moving away from the end, and play at the end starts over', () => {
    const onEnd = vi.fn();
    const c = make({ durationSec: 60, onEnd });
    c.seek(60);
    expect(onEnd).toHaveBeenCalledTimes(1);
    c.seek(30);
    c.step(1);
    expect(onEnd).toHaveBeenCalledTimes(2);
    c.play();
    expect(c.t()).toBe(0);
    expect(c.playing()).toBe(true);
  });

  it('pauses when the tab hides and resumes only if it was playing', () => {
    const c = make();
    c.play();
    vi.advanceTimersByTime(160);
    setVisibility('hidden');
    expect(c.playing()).toBe(false);
    const held = c.t();
    vi.advanceTimersByTime(1000);
    expect(c.t()).toBe(held);
    setVisibility('visible');
    expect(c.playing()).toBe(true);
    vi.advanceTimersByTime(160);
    expect(c.t()).toBeCloseTo(held + 8, 6);

    c.pause();
    setVisibility('hidden');
    setVisibility('visible');
    expect(c.playing()).toBe(false);
  });

  it('cancels its frame on destroy and never plays again', () => {
    const c = make();
    c.play();
    vi.advanceTimersByTime(160);
    const before = frames.requests;
    c.destroy();
    expect(frames.cancels).toBeGreaterThanOrEqual(1);
    expect(c.playing()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(frames.requests).toBe(before);
    c.play();
    expect(c.playing()).toBe(false);
    setVisibility('hidden');
    setVisibility('visible');
    expect(c.playing()).toBe(false);
  });

  it('destroys with the DestroyRef it is given', () => {
    let teardown: (() => void) | undefined;
    const destroyRef = { onDestroy: (fn: () => void) => ((teardown = fn), () => undefined) } as unknown as DestroyRef;
    const c = make({ destroyRef });
    c.play();
    expect(teardown).toBeTypeOf('function');
    teardown?.();
    expect(c.playing()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(c.t()).toBe(0);
  });

  it('only seeks where there are no animation frames', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    const c = make();
    c.play();
    expect(c.playing()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(c.t()).toBe(0);
    c.seek(90);
    expect(c.t()).toBe(90);
    c.pause();
    expect(c.playing()).toBe(false);
  });
});
