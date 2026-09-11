import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { INFLUENCE_TIP } from '../core/influence';
import { MvpChipComponent, MvpChipKind } from './mvp-chip.component';
import { TooltipDirective } from './tooltip.directive';

// Local mode, the way the film's chapter specs do it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The chip renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('MvpChipComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function mount(inputs: Partial<{ kind: MvpChipKind; champion: string; name: string; seat: string; terms: string[]; note: string; compact: boolean }>) {
    const fixture = TestBed.createComponent(MvpChipComponent);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, root, tip: () => fixture.debugElement.query(By.css('.mvp-chip')).injector.get(TooltipDirective).appTip() };
  }

  it('says MVP, the name, and puts the terms behind it in the tip', () => {
    const { root, tip } = mount({ kind: 'mvp', champion: 'Jinx', name: 'Rhu', seat: 'ADC', terms: ['52.5k damage, 38% of ours', 'on 14 of 20 kills', 'died twice'] });
    expect(text(root.querySelector('.mvp-chip-word'))).toBe('MVP');
    expect(text(root.querySelector('.mvp-chip-name'))).toBe('Rhu');
    expect(root.querySelector<HTMLImageElement>('.mvp-chip-icon')?.src).toContain('Jinx');
    expect(tip()).toBe('MVP: Rhu on Jinx. 52.5k damage, 38% of ours · on 14 of 20 kills · died twice.');
  });

  it('is a mark, never a control: no button, no link, and a focus the tip can reach', () => {
    // Every action on this app is a pill button; this is not an action, so it is neither that nor an <a>.
    const { root } = mount({ kind: 'mvp', champion: 'Jinx', name: 'Rhu' });
    expect(root.querySelector('button')).toBeNull();
    expect(root.querySelector('a')).toBeNull();
    const chip = root.querySelector('.mvp-chip')!;
    expect(chip.tagName).toBe('SPAN');
    // The terms live in the tooltip, and a tooltip only hover can open is one half the team never sees.
    expect(chip.getAttribute('tabindex')).toBe('0');
  });

  it('drops the name in the row\'s compact size and keeps the word in the tree', () => {
    const { root, tip } = mount({ kind: 'mvp', champion: 'Jinx', name: 'Rhu', terms: ['on 14 of 20 kills'], compact: true });
    expect(root.querySelector('.mvp-chip')?.classList.contains('is-compact')).toBe(true);
    expect(root.querySelector('.mvp-chip-name')).toBeNull();
    expect(text(root.querySelector('.mvp-chip-word'))).toBe('MVP');
    // Nothing is lost: the name is still in the tip.
    expect(tip()).toContain('Rhu on Jinx');
  });

  it('says Swung it most for the swing, and closes with what a minute cannot see', () => {
    const { root, tip } = mount({
      kind: 'swing',
      champion: 'Vi',
      name: 'Go10x',
      terms: ['+4.1k across the fights they were in', 'the biggest was the herald at 20'],
      note: INFLUENCE_TIP
    });
    expect(text(root.querySelector('.mvp-chip-word'))).toBe('Swung it most');
    expect(root.querySelector('.mvp-chip')?.classList.contains('is-swing')).toBe(true);
    expect(tip()).toBe(`Swung it most: Go10x on Vi. +4.1k across the fights they were in · the biggest was the herald at 20. ${INFLUENCE_TIP}`);
  });

  it('says Series MVP with the per-game lines and what the average is over', () => {
    const { root, tip } = mount({
      kind: 'series',
      champion: 'Jinx',
      name: 'Rhu',
      terms: ['Game 1 on Jinx: on 12 of 14 kills · died once', 'Game 2 on Ashe: on 5 of 8 kills · died four times'],
      note: 'Best line per game across the 2 games played.'
    });
    expect(text(root.querySelector('.mvp-chip-word'))).toBe('Series MVP');
    expect(root.querySelector('.mvp-chip')?.classList.contains('is-series')).toBe(true);
    expect(tip()).toBe(
      'Series MVP: Rhu on Jinx. Game 1 on Jinx: on 12 of 14 kills · died once · Game 2 on Ashe: on 5 of 8 kills · died four times. Best line per game across the 2 games played.'
    );
  });

  it('says the champion the display way, and falls back to whoever the game can name', () => {
    expect(mount({ kind: 'mvp', champion: 'MonkeyKing', name: '' }).tip()).toBe('MVP: Wukong.');
    // No champion on the game: the tile goes and the seat stands in, rather than an empty chip.
    const bare = mount({ kind: 'mvp', champion: '', name: '', seat: 'Jungle', terms: [] });
    expect(bare.root.querySelector('.mvp-chip-icon')).toBeNull();
    expect(text(bare.root.querySelector('.mvp-chip-name'))).toBe('Jungle');
    expect(bare.tip()).toBe('MVP: Jungle.');
  });

  it('never says score, drill or quiz', () => {
    const { root, tip } = mount({ kind: 'mvp', champion: 'Jinx', name: 'Rhu', terms: ['52.5k damage, 38% of ours'], note: 'Best line per game across the 3 games played.' });
    const said = `${text(root)} ${tip()}`.toLowerCase();
    for (const word of ['score', 'drill', 'quiz']) expect(said).not.toContain(word);
  });
});
