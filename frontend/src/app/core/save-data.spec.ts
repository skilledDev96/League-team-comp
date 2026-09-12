import { describe, expect, it } from 'vitest';
import { prefersSaveData } from './save-data';

/** Runs `read` with `globalThis.navigator` swapped for `value`, and puts the real one back however it ends. */
function withNavigator<T>(value: unknown, read: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  try {
    return read();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete (globalThis as unknown as { navigator?: unknown }).navigator;
  }
}

describe('prefersSaveData', () => {
  it('is on only when the connection says saveData is true', () => {
    expect(withNavigator({ connection: { saveData: true } }, prefersSaveData)).toBe(true);
    expect(withNavigator({ connection: { saveData: false } }, prefersSaveData)).toBe(false);
    expect(withNavigator({ connection: { saveData: 'true' } }, prefersSaveData)).toBe(false);
    expect(withNavigator({ connection: {} }, prefersSaveData)).toBe(false);
  });

  it('reads a browser with no connection, and an environment with no navigator, as off', () => {
    expect(withNavigator({}, prefersSaveData)).toBe(false);
    expect(withNavigator(undefined, prefersSaveData)).toBe(false);
  });

  it('reads a connection that throws as off rather than throwing', () => {
    const angry = Object.defineProperty({}, 'connection', {
      get() {
        throw new Error('not allowed');
      }
    });
    expect(withNavigator(angry, prefersSaveData)).toBe(false);
  });

  it('puts the real navigator back afterwards', () => {
    const before = globalThis.navigator;
    withNavigator({ connection: { saveData: true } }, prefersSaveData);
    expect(globalThis.navigator).toBe(before);
  });
});
