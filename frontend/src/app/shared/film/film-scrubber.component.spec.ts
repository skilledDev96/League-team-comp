import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FilmMoment } from '../../core/film-model';
import { clockText, FilmScrubberComponent, minuteAt, neighbourMoment, secAt } from './film-scrubber.component';

const moments: FilmMoment[] = [
  { minute: 8, text: 'First blood bot', swing: 'them' },
  { minute: 14, text: 'Dragon fight lost', swing: 'them' },
  { minute: 22, text: 'Baron taken', swing: 'us' }
];

describe('the scrubber seek math', () => {
  it('snaps a fraction of the track to whole seconds inside the game', () => {
    expect(secAt(0, 1800)).toBe(0);
    expect(secAt(0.5, 1800)).toBe(900);
    expect(secAt(0.33333, 1800)).toBe(600);
    expect(secAt(1, 1800)).toBe(1800);
    expect(secAt(-0.2, 1800)).toBe(0);
    expect(secAt(1.4, 1800)).toBe(1800);
    expect(secAt(Number.NaN, 1800)).toBe(0);
  });

  it('snaps a fraction of the track to whole minutes', () => {
    expect(minuteAt(0.5, 1800)).toBe(15);
    expect(minuteAt(0.49, 1800)).toBe(15);
    expect(minuteAt(0.46, 1800)).toBe(14);
    expect(minuteAt(1, 2050)).toBe(34);
    expect(minuteAt(2, 1800)).toBe(30);
  });

  it('finds the next and the previous moment, never the one under the hand', () => {
    expect(neighbourMoment(moments, 0, 1)?.minute).toBe(8);
    expect(neighbourMoment(moments, 480, 1)?.minute).toBe(14);
    expect(neighbourMoment(moments, 480, -1)).toBeUndefined();
    expect(neighbourMoment(moments, 1000, -1)?.minute).toBe(14);
    expect(neighbourMoment(moments, 1320, 1)).toBeUndefined();
    expect(neighbourMoment([], 100, 1)).toBeUndefined();
  });

  it('writes the clock as minutes and two-digit seconds', () => {
    expect(clockText(0)).toBe('0:00');
    expect(clockText(754)).toBe('12:34');
    expect(clockText(1800)).toBe('30:00');
    expect(clockText(-5)).toBe('0:00');
  });
});

describe('FilmScrubberComponent', () => {
  function mount(inputs: Partial<Record<string, unknown>> = {}) {
    const fixture = TestBed.createComponent(FilmScrubberComponent);
    const all = { durationSec: 1800, goldDiff: [0, 200, -400, -1500, -900, 300], t: 600, moments, revealed: true, guess: 14, answer: 12, playing: false, ...inputs };
    for (const [k, v] of Object.entries(all)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  it('draws the curve as far as the second shown, with the guess and the answer labelled', () => {
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    const curves = el.querySelectorAll('polyline.film-scrub-curve');
    expect(curves.length).toBe(2);
    // 600 of 1800 seconds shown: two thirds of the path stays hidden.
    expect((curves[0] as SVGElement).style.strokeDashoffset).toBe('667');
    expect(el.querySelector('.film-scrub-clock')?.textContent?.trim()).toBe('10:00');
    expect(el.querySelector('.film-scrub-verdict')?.textContent?.trim()).toBe('You said 14, it turned around 12');
    expect(el.querySelector('.film-scrub-verdict')?.classList.contains('is-close')).toBe(true);
    expect(el.querySelectorAll('.film-scrub-moment').length).toBe(3);
    expect(el.querySelector('.film-scrub-lock')).toBeNull();
  });

  it('hides the curve and the moments until the reveal and offers Lock once a guess is placed', () => {
    const fixture = mount({ revealed: false, guess: null, answer: null });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('polyline')).toBeNull();
    expect(el.querySelectorAll('.film-scrub-moment').length).toBe(0);
    expect(el.querySelector('.film-scrub-ask')?.textContent).toContain('Where did it turn?');
    const lock = el.querySelector('.film-scrub-lock') as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    fixture.componentRef.setInput('guess', 14);
    fixture.detectChanges();
    expect(lock.disabled).toBe(false);
  });

  it('walks a minute on the arrows, a moment with Shift, and toggles on Space', () => {
    const fixture = mount();
    const seeks: number[] = [];
    let toggles = 0;
    fixture.componentInstance.seek.subscribe((s) => seeks.push(s));
    fixture.componentInstance.toggle.subscribe(() => toggles++);
    const track = (fixture.nativeElement as HTMLElement).querySelector('.film-scrub-track') as HTMLElement;
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(seeks).toEqual([660, 540, 840]);
    expect(toggles).toBe(1);
  });

  it('moves the guess by whole minutes before the reveal and locks on Enter', () => {
    const fixture = mount({ revealed: false, guess: 10, answer: null });
    const guesses: number[] = [];
    let locks = 0;
    fixture.componentInstance.guessChange.subscribe((m) => guesses.push(m));
    fixture.componentInstance.lock.subscribe(() => locks++);
    const track = (fixture.nativeElement as HTMLElement).querySelector('.film-scrub-track') as HTMLElement;
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(guesses).toEqual([11, 30]);
    expect(locks).toBe(1);
  });
});
