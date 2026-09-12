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
  function mount(p: ReviewPlayer, mine: boolean, g?: AnalysisGame, own = false): { fixture: ComponentFixture<ReviewSeatComponent>; root: HTMLElement } {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(ReviewSeatComponent);
    fixture.componentRef.setInput('player', p);
    fixture.componentRef.setInput('mine', mine);
    fixture.componentRef.setInput('own', own);
    if (g) fixture.componentRef.setInput('game', g);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('draws the reader own seat as a block with the figures the game holds', () => {
    const { root } = mount(player(), true, game());
    expect(text(root.querySelector('.review-seat-name'))).toBe('Go10x');
    // Straight off the analysed game, not off the model's prose — and each figure in its own box,
    // so the farm and the vision can be found without reading a sentence of numbers.
    expect([...root.querySelectorAll('.review-seat-stat')].map((el) => text(el))).toEqual(['3/8/3', '218 CS', 'vision 29', '43% KP']);
    expect(root.querySelector('.review-seat')).not.toBeNull();
  });

  /**
   * The fold is a pill now, not a <summary> in small capitals (12 Sep 2026, the lead: "not sure
   * where to click"). What matters is that it says what pressing it will show, and that the points
   * are genuinely behind it rather than merely hidden — five open blocks is the wall this replaced.
   */
  /**
   * The fold is a <summary>, not a pill (12 Sep 2026). The lead's rule: a thing that collapses is
   * opened by its whole header, never by a small button sitting in it. Here that makes the entire
   * "What went well + 1 more" line the hit area instead of a pill at the end of it.
   */
  it('promises what the fold holds, and holds it until it is pressed', () => {
    const { fixture, root } = mount(player(), true, game());
    const fold = root.querySelector<HTMLElement>('summary.review-seat-fold');
    expect(fold, 'the whole line toggles, not a pill inside it').not.toBeNull();
    expect(root.querySelector('button.review-seat-fold'), 'and no pill is left behind').toBeNull();
    expect(text(fold)).toContain('What went well + 1 more to work on');

    const panel = fold!.closest('details') as HTMLDetailsElement;
    expect(panel.open).toBe(false);

    // Shut: the ask alone. The ask is the point of the block.
    expect(root.querySelectorAll('app-review-point').length).toBe(1);

    panel.open = true;
    panel.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(root.querySelectorAll('app-review-point').length).toBe(3);
    // And each group says what it is, rather than leaving three rows of chips unlabelled.
    expect([...root.querySelectorAll('.review-group-label')].map((el) => text(el))).toEqual(['Work on', 'What went well', 'More to work on']);
  });

  it('marks the reader own seat and leaves the others plain', () => {
    expect(mount(player(), true, game()).root.querySelector('.review-seat-you')).toBeNull();
    const own = mount(player(), true, game(), true).root;
    expect(text(own.querySelector('.review-seat-you'))).toBe('You');
    expect(own.querySelector('.review-seat.is-own')).not.toBeNull();
  });

  it('draws one face, not two', () => {
    // The champion's square and the player's round mark for one person is what made the row a puzzle.
    const { root } = mount(player(), true, game());
    expect(root.querySelectorAll('.review-seat-face').length).toBe(1);
    expect(root.querySelector('app-player-mark')).toBeNull();
  });

  it('draws no fold for a review that wrote neither', () => {
    // `more` arrived on version 3, so an older review has the ask and nothing else.
    const { root } = mount(player({ strength: point('') , more: undefined }), true, game());
    expect(root.querySelector('.review-seat-fold')).toBeNull();
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
