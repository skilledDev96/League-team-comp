import { DestroyRef, Signal, signal } from '@angular/core';

/**
 * A clock over game seconds for the reel and the tape (9 Sep 2026, the film
 * room). Every visual on them is a computed off `t`, so scrubbing and
 * playing are one code path: the clock only ever sets `t`. It asks for
 * animation frames while it plays and not otherwise, pauses when the tab is
 * hidden and picks up again when it comes back, and lets go of its frame
 * when destroyed. Without `requestAnimationFrame` (a test, a server) it
 * still seeks; it just never advances on its own.
 */
export interface FilmClock {
  /** Game time, in seconds, 0 to `durationSec`. */
  t: Signal<number>;
  playing: Signal<boolean>;
  durationSec: number;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Clamped to the game. */
  seek(sec: number): void;
  /** Forward or back by whole game minutes. */
  step(minutes: number): void;
  /** How many real seconds one game minute takes. */
  setRate(secPerGameMinute: number): void;
  destroy(): void;
}

export interface FilmClockOptions {
  durationSec: number;
  /** Default 1.2: a 30-minute game plays in 36 real seconds. */
  secPerGameMinute?: number;
  destroyRef?: DestroyRef;
  /** Called once each time the clock reaches the end. */
  onEnd?: () => void;
}

const DEFAULT_RATE = 1.2;

const now = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

export function createFilmClock(opts: FilmClockOptions): FilmClock {
  const durationSec = Math.max(0, Number.isFinite(opts.durationSec) ? opts.durationSec : 0);
  const hasFrames = typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
  const doc = typeof document !== 'undefined' ? document : null;

  const t = signal(0);
  const playing = signal(false);
  let rate = opts.secPerGameMinute && opts.secPerGameMinute > 0 ? opts.secPerGameMinute : DEFAULT_RATE;
  let frame: number | null = null;
  let last = 0;
  let ended = false;
  let resumeOnVisible = false;
  let destroyed = false;

  const cancel = (): void => {
    if (frame !== null && hasFrames) cancelAnimationFrame(frame);
    frame = null;
  };

  const reachEnd = (): void => {
    if (ended) return;
    ended = true;
    opts.onEnd?.();
  };

  const set = (sec: number): void => {
    let next = Math.min(durationSec, Math.max(0, Number.isFinite(sec) ? sec : 0));
    // Frames add up in floating point; a microsecond short of the end is the end.
    if (durationSec - next < 1e-6) next = durationSec;
    t.set(next);
    if (next < durationSec) {
      ended = false;
    } else {
      if (playing()) {
        playing.set(false);
        cancel();
      }
      reachEnd();
    }
  };

  const tick = (): void => {
    frame = null;
    if (!playing() || destroyed) return;
    const n = now();
    const elapsedMs = Math.max(0, n - last);
    last = n;
    set(t() + (elapsedMs / 1000) * (60 / rate));
    if (playing()) frame = requestAnimationFrame(tick);
  };

  const play = (): void => {
    if (destroyed || playing()) return;
    if (t() >= durationSec) {
      if (durationSec <= 0) return;
      set(0);
    }
    last = now();
    playing.set(true);
    if (hasFrames && frame === null) frame = requestAnimationFrame(tick);
  };

  const pause = (): void => {
    playing.set(false);
    cancel();
  };

  const onVisibility = (): void => {
    if (!doc) return;
    if (doc.visibilityState === 'hidden') {
      resumeOnVisible = playing();
      if (resumeOnVisible) pause();
    } else if (resumeOnVisible) {
      resumeOnVisible = false;
      play();
    }
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    pause();
    doc?.removeEventListener('visibilitychange', onVisibility);
  };
  opts.destroyRef?.onDestroy(destroy);

  return {
    t: t.asReadonly(),
    playing: playing.asReadonly(),
    durationSec,
    play,
    pause,
    toggle: () => (playing() ? pause() : play()),
    seek: (sec) => {
      last = now();
      set(sec);
    },
    step: (minutes) => {
      last = now();
      set(t() + minutes * 60);
    },
    setRate: (secPerGameMinute) => {
      if (Number.isFinite(secPerGameMinute) && secPerGameMinute > 0) rate = secPerGameMinute;
    },
    destroy
  };
}
