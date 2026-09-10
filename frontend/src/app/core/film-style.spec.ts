import { describe, expect, it } from 'vitest';
import { pick, seedOf } from './seed';
import {
  DEATH_ORDERS,
  easeOf,
  ENTRANCES,
  FilmStyle,
  LOSS_STOCKS,
  MOTIONS,
  stageClasses,
  STYLE_SALTS,
  styleFor,
  TAPE_RATES,
  tempoOf,
  TITLE_TREATMENTS,
  VOICE_INDEXES,
  VOICES,
  voiceOf,
  WIN_STOCKS
} from './film-style';

const SEEDS = Array.from({ length: 300 }, (_, i) => seedOf('EUW1_70000' + String(i).padStart(5, '0')));

describe('styleFor', () => {
  it('is the same style for the same seed, every time', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(styleFor(seed, true)).toEqual(styleFor(seed, true));
      expect(styleFor(seed, false)).toEqual(styleFor(seed, false));
    }
  });

  it('pins one film', () => {
    const seed = seedOf('EUW1_7000000001');
    const s = styleFor(seed, false);
    expect(s).toEqual({
      stock: pick(seed, LOSS_STOCKS, 'stock'),
      title: pick(seed, TITLE_TREATMENTS, 'title'),
      motion: pick(seed, MOTIONS, 'motion'),
      entrance: pick(seed, ENTRANCES, 'entrance'),
      deathOrder: pick(seed, DEATH_ORDERS, 'death-order'),
      tapeRate: pick(seed, TAPE_RATES, 'tape-rate'),
      voice: pick(seed, VOICE_INDEXES, 'voice')
    });
  });

  it('keeps every field inside its set', () => {
    for (const seed of SEEDS) {
      for (const win of [true, false]) {
        const s = styleFor(seed, win);
        expect(['broadcast', 'noir', 'blueprint']).toContain(s.stock);
        expect(TITLE_TREATMENTS).toContain(s.title);
        expect(MOTIONS).toContain(s.motion);
        expect(ENTRANCES).toContain(s.entrance);
        expect(DEATH_ORDERS).toContain(s.deathOrder);
        expect(TAPE_RATES).toContain(s.tapeRate);
        expect(VOICE_INDEXES).toContain(s.voice);
      }
    }
  });

  it('draws each field on its own salt, so the stock changing with the result moves nothing else', () => {
    const salts = Object.values(STYLE_SALTS);
    expect(new Set(salts).size).toBe(salts.length);
    for (const seed of SEEDS) {
      const win = styleFor(seed, true);
      const loss = styleFor(seed, false);
      const { stock: _w, ...restWin } = win;
      const { stock: _l, ...restLoss } = loss;
      expect(restWin).toEqual(restLoss);
    }
    // A field's own list changing (here: a longer stock list) leaves the other draws where they were.
    for (const seed of SEEDS.slice(0, 50)) {
      expect(pick(seed, TITLE_TREATMENTS, STYLE_SALTS.title)).toBe(styleFor(seed, true).title);
      expect(pick(seed, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], STYLE_SALTS.stock)).toBeDefined();
      expect(pick(seed, TITLE_TREATMENTS, STYLE_SALTS.title)).toBe(styleFor(seed, false).title);
    }
  });

  it('leans broadcast on a win and noir on a loss, and reaches every stock either way', () => {
    const count = (win: boolean) => {
      const n: Record<string, number> = { broadcast: 0, noir: 0, blueprint: 0 };
      for (const seed of SEEDS) n[styleFor(seed, win).stock]++;
      return n;
    };
    const wins = count(true);
    const losses = count(false);
    expect(wins['broadcast']).toBeGreaterThan(wins['noir']);
    expect(wins['broadcast']).toBeGreaterThan(wins['blueprint']);
    expect(losses['noir']).toBeGreaterThan(losses['broadcast']);
    expect(losses['noir']).toBeGreaterThan(losses['blueprint']);
    for (const stock of ['broadcast', 'noir', 'blueprint']) {
      expect(wins[stock]).toBeGreaterThan(0);
      expect(losses[stock]).toBeGreaterThan(0);
    }
    expect(WIN_STOCKS.filter((s) => s === 'broadcast')).toHaveLength(2);
    expect(LOSS_STOCKS.filter((s) => s === 'noir')).toHaveLength(2);
  });

  it('spreads the other fields across their sets over many games', () => {
    const seen = { title: new Set<string>(), motion: new Set<string>(), entrance: new Set<string>(), deathOrder: new Set<string>(), tapeRate: new Set<number>(), voice: new Set<number>() };
    for (const seed of SEEDS) {
      const s = styleFor(seed, true);
      seen.title.add(s.title);
      seen.motion.add(s.motion);
      seen.entrance.add(s.entrance);
      seen.deathOrder.add(s.deathOrder);
      seen.tapeRate.add(s.tapeRate);
      seen.voice.add(s.voice);
    }
    expect(seen.title.size).toBe(3);
    expect(seen.motion.size).toBe(2);
    expect(seen.entrance.size).toBe(3);
    expect(seen.deathOrder.size).toBe(2);
    expect(seen.tapeRate.size).toBe(3);
    expect(seen.voice.size).toBe(3);
  });
});

describe('the stage', () => {
  const style: FilmStyle = { stock: 'broadcast', title: 'curtain', motion: 'soft', entrance: 'rise', deathOrder: 'chronological', tapeRate: 1, voice: 0 };

  it('carries one class per look', () => {
    expect(stageClasses(style)).toEqual(['stock-broadcast', 'title-curtain', 'motion-soft', 'enter-rise']);
    expect(stageClasses({ ...style, stock: 'noir', title: 'stamp', motion: 'snappy', entrance: 'zoom' })).toEqual(['stock-noir', 'title-stamp', 'motion-snappy', 'enter-zoom']);
  });

  it('sets the tempo and the ease from the motion family', () => {
    expect(tempoOf(style)).toBe(1.15);
    expect(tempoOf({ ...style, motion: 'snappy' })).toBe(0.85);
    expect(easeOf(style)).toBe('cubic-bezier(.4,0,.2,1)');
    expect(easeOf({ ...style, motion: 'snappy' })).toBe('cubic-bezier(.2,.9,.3,1)');
  });
});

describe('the voice', () => {
  it('has three packs with every string filled and distinct, and the first is the default chrome', () => {
    expect(VOICES).toHaveLength(3);
    const keys = ['turnQuestion', 'lockPill', 'revealPill', 'nextDeath', 'watchIt', 'momentContinue'] as const;
    for (const key of keys) {
      const values = VOICES.map((v) => v[key]);
      expect(new Set(values).size).toBe(3);
      for (const v of values) expect(v.trim().length).toBeGreaterThan(0);
    }
    expect(VOICES[0]).toEqual({ turnQuestion: 'Where did it turn? Drag, then lock', lockPill: 'Lock', revealPill: 'Reveal', nextDeath: 'Next death', watchIt: 'Watch it', momentContinue: 'Continue' });
  });

  it('reads the pack the style names', () => {
    const base: FilmStyle = { stock: 'noir', title: 'stamp', motion: 'snappy', entrance: 'drop', deathOrder: 'worst-first', tapeRate: 1.25, voice: 2 };
    expect(voiceOf(base)).toBe(VOICES[2]);
    expect(voiceOf({ ...base, voice: 1 }).revealPill).toBe('Show me');
    expect(voiceOf({ ...base, voice: 0 }).turnQuestion).toBe('Where did it turn? Drag, then lock');
  });
});
