import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { ChampionDataService, ChampionInfo } from '../services/champion-data.service';
import { ChampionGridComponent } from './champion-grid.component';

// Local mode: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

/** Data Dragon's id and display name for the champions whose two spellings differ, and two that do not. */
const CHAMPIONS: [id: string, name: string][] = [
  ['MonkeyKing', 'Wukong'],
  ['MissFortune', 'Miss Fortune'],
  ['LeeSin', 'Lee Sin'],
  ['Kaisa', "Kai'Sa"],
  ['DrMundo', 'Dr. Mundo'],
  ['Nunu', 'Nunu & Willump'],
  ['Renata', 'Renata Glasc'],
  ['JarvanIV', 'Jarvan IV'],
  ['Ahri', 'Ahri'],
  ['Zed', 'Zed']
];

@Component({
  imports: [ChampionGridComponent],
  template: `<app-champion-grid [unavailable]="unavailable()" [taken]="taken()" (pick)="picks.push($event)" (emptyEnter)="empties = empties + 1" />`
})
class HostComponent {
  readonly unavailable = signal<string[]>([]);
  readonly taken = signal<ReadonlySet<string>>(new Set());
  readonly picks: string[] = [];
  empties = 0;
}

describe.skipIf(typeof localStorage === 'undefined')('ChampionGridComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.inject(ChampionDataService).champions.set(
      CHAMPIONS.map(([id, name], i) => ({ id, name, key: String(i), title: '', tags: [] }) as ChampionInfo)
    );
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const tiles = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.board-champ'));
  const label = (b: HTMLButtonElement) => b.querySelector('.board-champ-label')?.textContent?.trim();
  const greyed = () => tiles().filter((b) => b.disabled && b.classList.contains('is-blocked')).map(label);
  const ticked = () => tiles().filter((b) => b.classList.contains('is-taken')).map(label);

  it('greys every tile a replay burned under its Riot id', () => {
    host.unavailable.set(['MonkeyKing', 'MissFortune', 'LeeSin', 'Kaisa', 'DrMundo', 'Nunu', 'Renata', 'JarvanIV']);
    fixture.detectChanges();
    expect(greyed()).toEqual(['Wukong', 'Miss Fortune', 'Lee Sin', "Kai'Sa", 'Dr. Mundo', 'Nunu & Willump', 'Renata Glasc', 'Jarvan IV']);
  });

  it('greys a tile banned the way people type it', () => {
    host.unavailable.set(['missfortune', 'kai sa', 'wukong', 'dr mundo']);
    fixture.detectChanges();
    expect(greyed()).toEqual(['Wukong', 'Miss Fortune', "Kai'Sa", 'Dr. Mundo']);
  });

  it('leaves the rest of the wall pickable', () => {
    host.unavailable.set(['MonkeyKing']);
    fixture.detectChanges();
    expect(tiles().filter((b) => !b.disabled).map(label)).toEqual(CHAMPIONS.slice(1).map(([, name]) => name));
  });

  it('ticks a taken champion however the caller keyed its set', () => {
    // The draft room keys bans through the champion key, the comp board by lower case.
    host.taken.set(new Set(['wukong', 'miss fortune', "kai'sa", 'Renata']));
    fixture.detectChanges();
    expect(ticked()).toEqual(['Wukong', 'Miss Fortune', "Kai'Sa", 'Renata Glasc']);
  });

  const box = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.board-search')!;
  const pressEnter = (): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    box().dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  const type = async (text: string) => {
    box().value = text;
    box().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('keeps the comp board\'s hint when the caller names none', () => {
    expect(box().placeholder).toBe('Type a name, Enter takes the top match');
  });

  it('reports Enter on an empty box and keeps the key to itself (17 Sep 2026)', async () => {
    const empty = pressEnter();
    expect(host.empties).toBe(1);
    expect(empty.defaultPrevented).toBe(true);
    // Spaces are not a search.
    await type('   ');
    pressEnter();
    expect(host.empties).toBe(2);
    expect(host.picks).toEqual([]);
  });

  it('takes the top match on Enter with a search, and reports no empty box', async () => {
    await type('ahr');
    const typed = pressEnter();
    expect(host.picks).toEqual(['Ahri']);
    expect(host.empties).toBe(0);
    expect(typed.defaultPrevented).toBe(true);
  });
});
