import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ReviewPoint } from '../../models/team.models';
import { ReviewPointComponent } from './review-point.component';

/**
 * The line the whole cut turns on: a forty-word sentence has to come out as three chips without
 * losing anything. What matters here is the two fallbacks, because a stored review hits both — a
 * point whose evidence carries no separator, and one written before themes existed — and either
 * failing silently is a line that reads as broken rather than as absent.
 */
const point = (over: Partial<ReviewPoint> = {}): ReviewPoint => ({
  text: 'Nautilus went 0/9/15 and sat on 20 cs from minute 12 to 27, so either engage only behind Aphelios or spend those minutes on vision.',
  evidence: 'Nautilus 0/9/15 · 20 cs at 27:08 · level 10 vs their 12',
  minute: 20,
  theme: 'lanes',
  ...over
});

// TestBed needs the DOM the Angular runner provides; bare vitest steps aside.
describe.skipIf(typeof document === 'undefined')('ReviewPointComponent', () => {
  function mount(p: ReviewPoint, timed = true): { fixture: ComponentFixture<ReviewPointComponent>; root: HTMLElement } {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(ReviewPointComponent);
    fixture.componentRef.setInput('point', p);
    fixture.componentRef.setInput('timed', timed);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  const chips = (root: HTMLElement) => [...root.querySelectorAll('.evidence-chip')].map((el) => (el.textContent ?? '').trim());

  it('draws the evidence as chips and leaves the sentence to the tip', () => {
    const { root } = mount(point());
    expect(chips(root)).toEqual(['Nautilus 0/9/15', '20 cs at 27:08', 'level 10 vs their 12']);
    // The paragraph is not on screen at all; the info tip carries it.
    expect(root.querySelector('.review-point-said')).toBeNull();
    expect(root.textContent).not.toContain('Aphelios');
  });

  it('falls back to a short ask when the evidence will not split', () => {
    // `evidenceChips` hands back the whole string as one part, and one chip holding a clause is the
    // paragraph again in a box. The 320-character validator makes this shape reachable.
    const { root } = mount(point({ evidence: 'we lost the fight at Baron and never recovered from it' }));
    expect(chips(root)).toEqual([]);
    const said = (root.querySelector('.review-point-said')?.textContent ?? '').trim();
    expect(said.startsWith('Either engage only behind Aphelios')).toBe(true);
    expect(said.length).toBeLessThanOrEqual(121);
  });

  it('draws no glyph for a point that carries no theme', () => {
    // Optional since the field arrived on version 2; a blank square reads as a thing that failed.
    const { root } = mount(point({ theme: undefined }));
    expect(root.querySelector('svg.film-glyph')).toBeNull();
    expect(chips(root).length).toBe(3);
  });

  it('prints the minute only when no chip already carries a clock', () => {
    const withClock = mount(point()).root;
    expect(withClock.querySelector('.review-minute')).toBeNull();

    const noClock = mount(point({ evidence: 'grubs 3-0 · heralds 1-0 · towers 2-9' })).root;
    expect((noClock.querySelector('.review-minute')?.textContent ?? '').trim()).toBe('20 min');

    // A totals-only review has no real minutes, so none is printed whatever the evidence says.
    const untimed = mount(point({ evidence: 'grubs 3-0 · heralds 1-0 · towers 2-9' }), false).root;
    expect(untimed.querySelector('.review-minute')).toBeNull();
  });
});
