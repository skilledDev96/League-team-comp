import { readFileSync } from 'node:fs';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { seedOf } from '../../core/seed';
import { FilmStock, styleFor } from '../../core/film-style';
import { AnalysisGame, GameReview } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';
import { FilmPosterComponent } from '../../shared/film/film-poster.component';
import { FilmComponent } from './film.component';

/**
 * The class matrix: the film page under each stock and under three of the
 * themes, with the real stylesheet in the document. jsdom lays out nothing
 * and resolves neither `var()` nor `color-mix()`, but it does cascade the
 * declared values and the custom properties, so the spec resolves the
 * stage's background, ink and accent itself, on the theme's own tokens, and
 * asserts they are opaque, readable and different where they should be.
 */

const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const STOCKS: FilmStock[] = ['broadcast', 'noir', 'blueprint'];
const THEMES = ['bomb', 'light', 'void'];

/** A match id whose loss draws the stock asked for; the seed is the id, so the search is deterministic. */
function idFor(stock: FilmStock): string {
  for (let i = 1; i < 2000; i++) {
    const id = 'EUW1_70000' + String(i).padStart(5, '0');
    if (styleFor(seedOf(id), false).stock === stock) return id;
  }
  throw new Error('no id draws ' + stock);
}

const point = (text: string, theme?: string) => ({ text, evidence: 'kills 14-35', minute: null, theme });

const gameFor = (matchId: string) =>
  ({
    matchId,
    date: 1757400000000,
    queue: 'Flex',
    win: false,
    durationSec: 34 * 60,
    kills: { ours: 14, theirs: 35 },
    players: [{ name: 'Rhu#BOM', position: 'BOTTOM', champion: 'Jinx', kills: 8, deaths: 3, assists: 2, cs: 312, damage: 1, killParticipation: 0.71 }]
  }) as unknown as AnalysisGame;

const reviewFor = (matchId: string) =>
  ({
    matchId,
    reviewedAt: '2026-09-09T20:00:00.000Z',
    reviewVersion: 3,
    tier: 'endOfGame',
    trigger: 'manual',
    models: { team: 'x', players: 'x' },
    compId: null,
    compName: null,
    team: {
      headline: 'Bled 35 kills while farming even',
      summary: 'The team matched on CS but gave up the fights.',
      workOn: [point('Play safer trades before towers fall.', 'fights')],
      keepDoing: [point('Farm held up across the map.', 'lanes')],
      compVerdict: 'off plan',
      compWhy: 'The fights came early.'
    },
    players: [{ name: 'Rhu', seat: 'ADC', champion: 'Jinx', strength: point('Farmed 312.'), workOn: point('Hold the wave under tower.') }],
    usage: { team: { input: 0, cachedInput: 0, output: 0 }, players: { input: 0, cachedInput: 0, output: 0 }, costUsd: 0, tookMs: 0 }
  }) as unknown as GameReview;

// ---- A small resolver for what jsdom hands back: var() chains and color-mix() over the theme's hex tokens ----

type Rgba = [number, number, number, number];

function parseColor(s: string): Rgba | null {
  const v = s.trim().toLowerCase();
  if (v === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

/** Split on the commas at the top level, so a nested var() or color-mix() stays whole. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim());
}

function colourAndPercent(part: string): [string, number | null] {
  const m = /^(.*?)\s+([\d.]+)%$/s.exec(part.trim());
  return m ? [m[1], Number(m[2])] : [part.trim(), null];
}

/** color-mix in srgb, premultiplied, the way the browser does it. */
function mix(a: Rgba, wa: number, b: Rgba, wb: number): Rgba {
  const sum = wa + wb;
  const pa = wa / sum;
  const pb = wb / sum;
  const alpha = a[3] * pa + b[3] * pb;
  if (alpha === 0) return [0, 0, 0, 0];
  const ch = (i: number) => Math.round((a[i] * a[3] * pa + b[i] * b[3] * pb) / alpha);
  return [ch(0), ch(1), ch(2), Math.round(alpha * 1000) / 1000];
}

function resolve(el: Element, value: string, depth = 0): Rgba {
  const v = value.trim();
  if (depth > 16) throw new Error('a var() chain that never lands: ' + value);
  const asVar = /^var\((--[\w-]+)(?:\s*,\s*(.*))?\)$/s.exec(v);
  if (asVar) {
    const own = getComputedStyle(el).getPropertyValue(asVar[1]).trim();
    if (own) return resolve(el, own, depth + 1);
    if (asVar[2]) return resolve(el, asVar[2], depth + 1);
    throw new Error(asVar[1] + ' is unset');
  }
  const asMix = /^color-mix\(in srgb,\s*(.*)\)$/s.exec(v);
  if (asMix) {
    const [first, second] = splitTop(asMix[1]);
    const [ca, pa] = colourAndPercent(first);
    const [cb, pb] = colourAndPercent(second);
    let wa = pa;
    let wb = pb;
    if (wa === null && wb === null) wa = wb = 50;
    else if (wa === null) wa = 100 - wb!;
    else if (wb === null) wb = 100 - wa;
    return mix(resolve(el, ca, depth + 1), wa!, resolve(el, cb, depth + 1), wb!);
  }
  const c = parseColor(v);
  if (!c) throw new Error('not a colour: ' + value);
  return c;
}

const key = (c: Rgba) => c.join(',');
const opaque = (c: Rgba) => c[3] === 1;
/** Relative luminance, for a coarse readability check between the ink and the ground. */
function luma(c: Rgba): number {
  const lin = (n: number) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luma(a), luma(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

interface Cell {
  bg: Rgba;
  ink: Rgba;
  a: Rgba;
  classes: string[];
  tempo: string;
  ease: string;
}

async function mount(matchId: string): Promise<HTMLElement> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/film/${matchId}`, FilmComponent);
  await Promise.resolve();
  harness.detectChanges();
  return harness.routeNativeElement as HTMLElement;
}

describe.skipIf(typeof localStorage === 'undefined')('the film stocks under the themes', () => {
  const ids = Object.fromEntries(STOCKS.map((s) => [s, idFor(s)])) as Record<FilmStock, string>;
  const matrix = new Map<string, Cell>();
  let styleEl: HTMLStyleElement | null = null;

  beforeAll(() => {
    let css = '';
    for (const path of ['src/styles.css', 'frontend/src/styles.css']) {
      try {
        css = readFileSync(path, 'utf8') as string;
        break;
      } catch {
        /* the other cwd */
      }
    }
    expect(css.length).toBeGreaterThan(1000);
    styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  });

  afterAll(() => {
    styleEl?.remove();
    delete document.body.dataset['theme'];
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'film/:matchId', component: FilmComponent }])] });
  });

  for (const theme of THEMES) {
    for (const stock of STOCKS) {
      it(`mounts ${stock} under ${theme} with the stage's classes, tempo and ease, and resolves its colours`, async () => {
        const id = ids[stock];
        const data = TestBed.inject(TeamDataService);
        data.gameReviews.set([reviewFor(id)]);
        data.compAnalysis.set({ games: [gameFor(id)] } as never);
        const root = await mount(id);
        document.body.dataset['theme'] = theme;
        const stage = root.querySelector<HTMLElement>('.film-stage')!;
        expect(stage).not.toBeNull();
        const style = styleFor(seedOf(id), false);
        const classes = Array.from(stage.classList);
        expect(classes).toContain('stock-' + stock);
        expect(classes.filter((c) => c.startsWith('stock-'))).toHaveLength(1);
        expect(classes.filter((c) => c.startsWith('title-'))).toEqual(['title-' + style.title]);
        expect(classes.filter((c) => c.startsWith('motion-'))).toEqual(['motion-' + style.motion]);
        expect(classes.filter((c) => c.startsWith('enter-'))).toEqual(['enter-' + style.entrance]);
        const tempo = stage.style.getPropertyValue('--film-tempo');
        const ease = stage.style.getPropertyValue('--film-ease');
        expect(tempo).toBe(style.motion === 'snappy' ? '0.85' : '1.15');
        expect(ease).toBe(style.motion === 'snappy' ? 'cubic-bezier(.2,.9,.3,1)' : 'cubic-bezier(.4,0,.2,1)');

        const cs = getComputedStyle(stage);
        const cell: Cell = {
          bg: resolve(stage, cs.background || cs.backgroundColor),
          ink: resolve(stage, cs.color),
          a: resolve(stage, cs.getPropertyValue('--film-a')),
          classes,
          tempo,
          ease
        };
        matrix.set(theme + '/' + stock, cell);
        expect(opaque(cell.bg)).toBe(true);
        expect(opaque(cell.ink)).toBe(true);
        expect(opaque(cell.a)).toBe(true);
        expect(key(cell.bg)).not.toBe(key(cell.ink));
        // Pale ink on a dark stage in every theme: the light theme swaps to a graphite stage rather than a pale one.
        expect(luma(cell.ink)).toBeGreaterThan(luma(cell.bg));
        // The dark themes clear 10; the light theme's lifted graphite (bg-0 mixed 35% into text-0) clears AA at about 4.1.
        expect(contrast(cell.ink, cell.bg)).toBeGreaterThan(4);
        expect(contrast(cell.a, cell.bg)).toBeGreaterThan(2);
      });
    }
  }

  it('gives the three stocks three accents in each theme, on one stage', () => {
    for (const theme of THEMES) {
      const cells = STOCKS.map((s) => matrix.get(theme + '/' + s)!);
      expect(cells.every(Boolean)).toBe(true);
      expect(new Set(cells.map((c) => key(c.a))).size).toBe(3);
      // The stage itself is the theme's: the stocks change the chrome, not the ground or the ink.
      expect(new Set(cells.map((c) => key(c.bg))).size).toBe(1);
      expect(new Set(cells.map((c) => key(c.ink))).size).toBe(1);
    }
  });

  it('follows the theme: each stock reads differently under bomb, light and void', () => {
    for (const stock of STOCKS) {
      const cells = THEMES.map((t) => matrix.get(t + '/' + stock)!);
      expect(new Set(cells.map((c) => key(c.bg))).size).toBe(3);
      expect(new Set(cells.map((c) => key(c.a))).size).toBe(3);
    }
    // The light theme's ink is its pale ground, not its dark text.
    expect(key(matrix.get('light/noir')!.ink)).not.toBe(key(matrix.get('bomb/noir')!.ink));
  });

  it('marks the poster with the same stock, so a row hints at the film', () => {
    for (const stock of STOCKS) {
      const fixture = TestBed.createComponent(FilmPosterComponent);
      fixture.componentRef.setInput('review', reviewFor(ids[stock]));
      fixture.componentRef.setInput('game', gameFor(ids[stock]));
      fixture.detectChanges();
      const poster = fixture.nativeElement.querySelector('.film-poster') as HTMLElement;
      expect(poster.classList.contains('stock-' + stock)).toBe(true);
      expect(Array.from(poster.classList).filter((c) => c.startsWith('stock-'))).toHaveLength(1);
      fixture.destroy();
    }
  });
});
