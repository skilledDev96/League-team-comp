import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GameReview, ReviewTheme } from '../../models/team.models';
import { DecidedByComponent } from './decided-by.component';

/**
 * The first thing the panel shows, and the one piece of it meant to be read at a glance rather than
 * read at all. What matters in a test is the honest-absence branch: eleven stored reviews predate
 * the field this reads, and a blank glyph over an empty word reads as a thing that failed to load.
 */
const review = (team: object): GameReview => ({ team, players: [] }) as unknown as GameReview;
const point = (theme?: ReviewTheme) => ({ text: 'x', evidence: '', minute: null, ...(theme ? { theme } : {}) });

// TestBed needs the DOM the Angular runner provides; bare vitest steps aside.
describe.skipIf(typeof document === 'undefined')('DecidedByComponent', () => {
  function mount(r: GameReview | undefined): { fixture: ComponentFixture<DecidedByComponent>; root: HTMLElement } {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(DecidedByComponent);
    fixture.componentRef.setInput('review', r);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('names the cause with one glyph and one word', () => {
    const { root } = mount(review({ workOn: [point('fights')] }));
    expect(text(root.querySelector('.review-decided-word'))).toBe('Fights');
    expect(text(root.querySelector('.review-decided-label'))).toBe('Decided by');
    // The film's own glyph, not a Material icon: a theme is content, and the two families must not mix.
    expect(root.querySelector('svg.film-glyph')).not.toBeNull();
    expect(root.querySelector('.material-symbols-rounded')).toBeNull();
  });

  it('draws the three themes that had no glyph until this', () => {
    // `lanes`, `tempo` and `macro` were the reason the panel reached for Material icons.
    for (const [theme, word] of [
      ['lanes', 'Lanes'],
      ['tempo', 'Tempo'],
      ['macro', 'Macro']
    ] as [ReviewTheme, string][]) {
      const { root } = mount(review({ workOn: [point(theme)] }));
      expect(text(root.querySelector('.review-decided-word')), theme).toBe(word);
      expect(root.querySelector('svg.film-glyph path'), theme).not.toBeNull();
    }
  });

  it('renders nothing at all rather than an empty verdict', () => {
    // A review with no work-ons, a point with no theme, and no review at all — all three exist.
    for (const r of [review({ workOn: [] }), review({ workOn: [point()] }), undefined]) {
      const { root } = mount(r);
      expect(root.querySelector('.review-decided')).toBeNull();
      expect(text(root)).toBe('');
    }
  });
});
