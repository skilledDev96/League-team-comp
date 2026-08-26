import { vi } from 'vitest';

// jsdom doesn't implement matchMedia, which ThemeService reads on construction.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

// Keep tests offline: services that fetch on construction (e.g. the Data Dragon
// champion index) fail fast instead of making real network requests.
vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.reject(new Error('network disabled in tests')))
);
