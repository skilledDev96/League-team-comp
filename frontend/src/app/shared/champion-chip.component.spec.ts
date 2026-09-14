import { TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { ChampionChipComponent } from './champion-chip.component';

// Local mode, the way the other shared specs do it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The Data Dragon index as the champion service caches it, for the ids the static map does not carry. */
function seedIndex(): void {
  const champ = (id: string, name: string) => ({ id, key: '0', name, title: '', tags: [] });
  localStorage.setItem('bom-ddragon-v1', JSON.stringify({ version: '15.1.1', champions: [champ('MasterYi', 'Master Yi'), champ('Fiddlesticks', 'Fiddlesticks'), champ('MonkeyKing', 'Wukong')] }));
}

// The chip renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('ChampionChipComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function mount(champion: string, label = '') {
    const fixture = TestBed.createComponent(ChampionChipComponent);
    fixture.componentRef.setInput('champion', champion);
    if (label) fixture.componentRef.setInput('label', label);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { root, name: () => text(root.querySelector('span')), img: () => root.querySelector<HTMLImageElement>('img')! };
  }

  it('prints the display name for Riot ids the Prep pool and the game boards carry (audit: MonkeyKing, JarvanIV, Kaisa)', () => {
    expect(mount('MonkeyKing').name()).toBe('Wukong');
    expect(mount('JarvanIV').name()).toBe('Jarvan IV');
    expect(mount('Kaisa').name()).toBe("Kai'Sa");
    expect(mount('TahmKench').name()).toBe('Tahm Kench');
  });

  it('reads the loaded champion index for ids the static map does not know (MasterYi, FiddleSticks)', () => {
    seedIndex();
    expect(mount('MasterYi').name()).toBe('Master Yi');
    expect(mount('FiddleSticks').name()).toBe('Fiddlesticks');
  });

  it('keeps the icon and its alt on the raw id, and a given label wins over the name', () => {
    const { img, name } = mount('MonkeyKing');
    expect(img().src).toContain('/MonkeyKing.png');
    expect(img().alt).toBe('MonkeyKing icon');
    expect(name()).toBe('Wukong');
    expect(mount('MonkeyKing', 'Wukong Top').name()).toBe('Wukong Top');
  });
});
