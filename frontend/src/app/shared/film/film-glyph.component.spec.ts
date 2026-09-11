import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FilmGlyph } from '../../core/film-model';
import { FILM_GLYPHS, FilmGlyphComponent, GLYPH_TIPS } from './film-glyph.component';

/** Every name the model knows, kept here so a glyph added to the type without a drawing fails loudly. */
const NAMES: FilmGlyph[] = [
  'ward', 'ward-off', 'jungler', 'jungler-far', 'horn', 'footsteps', 'tower', 'dragon', 'baron', 'herald', 'grubs', 'atakhan',
  'swords', 'skull', 'shield', 'wall', 'fist', 'coin', 'swap', 'flag', 'eye', 'blood', 'bolt', 'poke', 'sustain', 'split',
  'wave', 'hook', 'wind', 'lane', 'clock', 'map', 'check'
];

/** Path data only: commands, numbers, separators. Nothing that could smuggle markup in. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.\-]+$/;

describe('FILM_GLYPHS', () => {
  it('draws every glyph the model names, with at least one path', () => {
    expect(NAMES.length).toBe(33);
    for (const name of NAMES) {
      const g = FILM_GLYPHS[name];
      expect(g, name).toBeDefined();
      expect(g.paths.length, name).toBeGreaterThan(0);
    }
    expect(Object.keys(FILM_GLYPHS).sort()).toEqual([...NAMES].sort());
  });

  it('keeps every path to path data and every circle inside the grid', () => {
    for (const name of NAMES) {
      const g = FILM_GLYPHS[name];
      for (const d of g.paths) expect(d, `${name}: ${d}`).toMatch(PATH_DATA);
      for (const c of g.circles ?? []) {
        expect(c.r, name).toBeGreaterThan(0);
        expect(c.cx - c.r, name).toBeGreaterThanOrEqual(0);
        expect(c.cx + c.r, name).toBeLessThanOrEqual(24);
        expect(c.cy - c.r, name).toBeGreaterThanOrEqual(0);
        expect(c.cy + c.r, name).toBeLessThanOrEqual(24);
      }
    }
  });

  it('gives no two glyphs the same drawing', () => {
    const seen = new Map<string, FilmGlyph>();
    for (const name of NAMES) {
      const key = JSON.stringify(FILM_GLYPHS[name]);
      expect(seen.get(key), `${name} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, name);
    }
  });

  it('has a tip for every glyph, and none of them says drill, quiz or score', () => {
    for (const name of NAMES) {
      expect(GLYPH_TIPS[name], name).toBeTruthy();
      expect(GLYPH_TIPS[name].toLowerCase(), name).not.toMatch(/drill|quiz|score/);
    }
  });
});

describe('FilmGlyphComponent', () => {
  function mount(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(FilmGlyphComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the named glyph as a decorative svg by default', () => {
    const el = mount({ name: 'ward-off' });
    const svg = el.querySelector('svg.film-glyph') as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('data-glyph')).toBe('ward-off');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelectorAll('path').length).toBe(FILM_GLYPHS['ward-off'].paths.length);
    expect(svg.querySelectorAll('circle').length).toBe(FILM_GLYPHS['ward-off'].circles?.length ?? 0);
    expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('currentColor');
    expect(svg.style.getPropertyValue('--g')).toBe('1');
  });

  it('becomes an image with a name when given a label, and takes a size in em', () => {
    const el = mount({ name: 'dragon', label: 'A dragon', size: 1.5 });
    const svg = el.querySelector('svg.film-glyph') as SVGSVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('A dragon');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.style.getPropertyValue('--g')).toBe('1.5');
    // The paths are bound one by one, never as markup: each <path> carries exactly one entry of the table.
    const ds = Array.from(svg.querySelectorAll('path')).map((p) => p.getAttribute('d'));
    expect(ds).toEqual(FILM_GLYPHS.dragon.paths);
  });
});
