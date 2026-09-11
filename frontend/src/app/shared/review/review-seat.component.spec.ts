import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AnalysisGame, GameReview } from '../../models/team.models';
import { ReviewSeatComponent } from './review-seat.component';

type ReviewPlayer = GameReview['players'][number];

const point = (text: string, evidence = 'a 1/2/3 · b 4-5') => ({ text, evidence, minute: null, theme: 'lanes' as const });

const player = (over: Partial<ReviewPlayer> = {}): ReviewPlayer =>
  ({
    name: 'Go10x',
    seat: 'Jungle',
    champion: 'MonkeyKing',
    strength: point('Pathed well through the early grubs.'),
    workOn: point('Be topside by 18 minutes, or say you cannot.'),
    more: [point('Ward the enemy raptors before the second dragon.')],
    ...over
  }) as ReviewPlayer;

const game = (): AnalysisGame =>
  ({
    players: [{ position: 'JUNGLE', name: 'Go10x', champion: 'MonkeyKing', kills: 3, deaths: 8, assists: 3, cs: 218, visionScore: 29, killParticipation: 0.43 }]
  }) as unknown as AnalysisGame;

// TestBed needs the DOM the Angular runner provides; bare vitest steps aside.
describe.skipIf(typeof document === 'undefined')('ReviewSeatComponent', () => {
  function mount(p: ReviewPlayer, mine: boolean, g?: AnalysisGame): { fixture: ComponentFixture<ReviewSeatComponent>; root: HTMLElement } {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(ReviewSeatComponent);
    fixture.componentRef.setInput('player', p);
    fixture.componentRef.setInput('mine', mine);
    if (g) fixture.componentRef.setInput('game', g);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('draws the reader own seat as a block with the figures the game holds', () => {
    const { root } = mount(player(), true, game());
    expect(text(root.querySelector('.review-seat-name'))).toBe('Go10x');
    // Straight off the analysed game, not off the model's prose.
    expect(text(root.querySelector('.review-seat-stats'))).toBe('3/8/3 · 218 CS · vision 29 · 43% KP');
    expect(root.querySelector('.review-seat')).not.toBeNull();
  });

  it('folds the strength and the further points, which the panel never showed', () => {
    const { root } = mount(player(), true, game());
    const fold = root.querySelector('.review-seat-more');
    expect(fold).not.toBeNull();
    expect(text(fold!.querySelector('summary'))).toBe('What went well · 1 more to work on');
    // Behind the fold, not gone: both are in the tree for a reader who opens it.
    expect(fold!.querySelectorAll('app-review-point').length).toBe(2);
  });

  it('draws no fold for a review that wrote neither', () => {
    // `more` arrived on version 3, so an older review has the ask and nothing else.
    const { root } = mount(player({ strength: point('') , more: undefined }), true, game());
    expect(root.querySelector('.review-seat-more')).toBeNull();
  });

  it('draws everybody else as one line, not as a block', () => {
    const { root } = mount(player(), false, game());
    expect(root.querySelector('.review-seat')).toBeNull();
    expect(root.querySelector('.review-point')).not.toBeNull();
    expect(text(root)).toContain('Go10x');
  });

  it('leaves the stat line out rather than inventing one', () => {
    // A game the analysis no longer carries: the review still reads, the figures simply are not there.
    const { root } = mount(player(), true);
    expect(root.querySelector('.review-seat-stats')).toBeNull();
  });
});
