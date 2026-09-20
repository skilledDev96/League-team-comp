import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { ChampionDataService, ChampionInfo } from '../services/champion-data.service';
import { CompFallbacks, CompPicks } from '../models/team.models';
import { CompBoardComponent } from './comp-board.component';

// Local mode: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const CHAMPIONS = ['Maokai', 'Vi', 'Ahri', 'Jinx', 'Nautilus', 'Leona', 'Rell', 'Alistar', 'Thresh', 'Braum'];

const EMPTY: CompPicks = { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' };

/**
 * The host writes the board's one output straight back into its inputs, which is exactly what the comp
 * sheet does through `CompWritesService.saveSeats` — so a spec that passes here is a gesture that lands.
 */
@Component({
  imports: [CompBoardComponent],
  template: `<app-comp-board [picks]="picks()" [fallbacks]="fallbacks()" (change)="apply($event)" />`
})
class HostComponent {
  readonly picks = signal<CompPicks>({ ...EMPTY });
  readonly fallbacks = signal<CompFallbacks | undefined>(undefined);
  writes = 0;

  apply(seats: { picks: CompPicks; fallbacks?: CompFallbacks }): void {
    this.writes += 1;
    this.picks.set(seats.picks);
    this.fallbacks.set(seats.fallbacks);
  }
}

describe.skipIf(typeof localStorage === 'undefined')('CompBoardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.inject(ChampionDataService).champions.set(
      CHAMPIONS.map((name, i) => ({ id: name, name, key: String(i), title: '', tags: [] }) as ChampionInfo)
    );
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const slots = () => Array.from(root().querySelectorAll<HTMLElement>('.board-slot'));
  const slot = (role: string) =>
    slots().find((li) => li.querySelector('.board-role')?.textContent?.trim() === role)!;
  const press = (el: Element | null | undefined) => {
    (el as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const pick = (name: string) => {
    const tile = Array.from(root().querySelectorAll<HTMLButtonElement>('.board-champ')).find(
      (b) => b.querySelector('.board-champ-label')?.textContent?.trim() === name
    );
    press(tile);
  };
  const chips = (role: string) =>
    Array.from(slot(role).querySelectorAll<HTMLElement>('.board-fallbacks .champ-picker-chip')).map((c) =>
      c.querySelector('.board-chip-main span')?.textContent?.trim()
    );
  const championIn = (role: string) => slot(role).querySelector('.board-champ-name')?.textContent?.trim() ?? '';
  const aimLine = () => root().querySelector('.board-aim')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const fallbackPill = (role: string) => slot(role).querySelector<HTMLButtonElement>('.board-fallback-add');

  const fill = () => {
    press(slot('Top').querySelector('.board-slot-main'));
    pick('Maokai');
    pick('Vi');
    pick('Ahri');
    pick('Jinx');
    pick('Nautilus');
  };

  it('fills the five by pressing a seat and clicking, advancing through the empties', () => {
    fill();
    expect(host.picks()).toEqual({
      Top: 'Maokai',
      Jungle: 'Vi',
      Mid: 'Ahri',
      ADC: 'Jinx',
      Support: 'Nautilus'
    });
    expect(host.fallbacks()).toBeUndefined();
  });

  it('offers no fallback control on an empty seat, because a fallback needs a priority', () => {
    expect(fallbackPill('Top')).toBeNull();
    press(slot('Top').querySelector('.board-slot-main'));
    pick('Maokai');
    expect(fallbackPill('Top')).not.toBeNull();
  });

  it('adds three fallbacks in three clicks, focus staying on the seat', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    pick('Rell');
    pick('Alistar');
    expect(chips('Support')).toEqual(['Leona', 'Rell', 'Alistar']);
    expect(championIn('Support')).toContain('Nautilus');
  });

  it('says what the next click does, and says when a seat is full', () => {
    fill();
    press(slot('Top').querySelector('.board-slot-main'));
    expect(aimLine()).toContain('Filling Top');
    press(fallbackPill('Support'));
    expect(aimLine()).toContain('Adding fallbacks to Support — 1 of 4');
    pick('Leona');
    pick('Rell');
    pick('Alistar');
    expect(aimLine()).toContain('Support already holds 4');
    // The pill stays pressable at the cap: a disabled button can fire neither the tip that says why
    // it is grey nor the line that says it here, and the wall click is refused anyway.
    expect(fallbackPill('Support')?.disabled).toBe(false);
    press(slot('Top').querySelector('.board-slot-main'));
    expect(aimLine()).toContain('Filling Top');
    press(fallbackPill('Support'));
    expect(aimLine()).toContain('Support already holds 4');
  });

  it('refuses a fifth champion on a seat rather than silently replacing one', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    pick('Rell');
    pick('Alistar');
    const before = host.writes;
    pick('Thresh');
    expect(host.writes).toBe(before);
    expect(chips('Support')).toEqual(['Leona', 'Rell', 'Alistar']);
  });

  it('keeps the wall reachable on a finished comp through the seat’s own pill', () => {
    fill();
    // The fifth priority closes the wall, as it always has.
    expect(root().querySelector('.board-champ')).toBeNull();
    press(fallbackPill('Support'));
    expect(root().querySelector('.board-champ')).not.toBeNull();
  });

  it('clicking a champion already in the comp removes that entry, not the seat', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    pick('Rell');
    pick('Leona');
    expect(chips('Support')).toEqual(['Rell']);
    expect(championIn('Support')).toContain('Nautilus');
  });

  it('taking an entry off a seat that is still filled leaves the aim where the reader put it', () => {
    // Otherwise the aim jumped to a seat that still holds a champion, and the natural second click
    // on the same champion replaced that seat's priority — two ordinary clicks and a pick was gone.
    fill();
    press(fallbackPill('Top'));
    pick('Thresh');
    press(fallbackPill('Support'));
    pick('Thresh'); // Meant as a Support fallback; it is Top's, so it comes off Top instead.
    expect(championIn('Top')).toContain('Maokai');
    expect(aimLine()).toContain('Adding fallbacks to Support');
    pick('Braum');
    expect(chips('Support')).toEqual(['Braum']);
    expect(championIn('Top')).toContain('Maokai');
    expect(chips('Top')).toEqual([]);
  });

  it('drops the aim back to the priority once the focused seat is emptied from the wall', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    pick('Nautilus'); // The priority goes, Leona is promoted: the seat is still a seat with fallbacks.
    expect(championIn('Support')).toContain('Leona');
    expect(aimLine()).toContain('Adding fallbacks to Support');
    pick('Leona'); // Now it is empty, so the pill is gone and the next click sets the priority.
    expect(championIn('Support')).toBe('');
    expect(fallbackPill('Support')).toBeNull();
    expect(aimLine()).toContain('Filling Support');
    pick('Thresh');
    expect(championIn('Support')).toContain('Thresh');
    // The fifth priority closes the wall, as filling any last seat always has.
    expect(root().querySelector('.board-champ')).toBeNull();
  });

  it('clearing a priority promotes the first fallback rather than emptying a seat with chips under it', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    pick('Rell');
    press(slot('Support').querySelector('.board-clear'));
    expect(championIn('Support')).toContain('Leona');
    expect(chips('Support')).toEqual(['Rell']);
  });

  it('pressing a chip’s body promotes it, the old priority dropping in behind', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    pick('Rell');
    press(slot('Support').querySelectorAll('.board-chip-main')[1]);
    expect(championIn('Support')).toContain('Rell');
    expect(chips('Support')).toEqual(['Nautilus', 'Leona']);
  });

  it('a chip’s × takes that one out', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    pick('Rell');
    press(slot('Support').querySelector('.champ-picker-remove'));
    expect(chips('Support')).toEqual(['Rell']);
  });

  it('emits both fields together, so one gesture is one write', () => {
    fill();
    const before = host.writes;
    press(fallbackPill('Support'));
    pick('Leona');
    expect(host.writes).toBe(before + 1);
    expect(host.picks().Support).toBe('Nautilus');
    expect(host.fallbacks()).toEqual({ Support: ['Leona'] });
  });

  it('the note field edits the priority, and the note survives a fallback being added', () => {
    fill();
    const note = slot('Support').querySelector<HTMLInputElement>('.board-note')!;
    note.value = 'hook engage';
    note.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.picks().Support).toBe('Nautilus - hook engage');

    press(fallbackPill('Support'));
    pick('Leona');
    expect(host.picks().Support).toBe('Nautilus - hook engage');
    expect(host.fallbacks()).toEqual({ Support: ['Leona'] });
  });

  it('does not hear a note field’s own change event as a seat write', () => {
    // The output is named `change` and a native change event bubbles. Angular binds the output AND a
    // native DOM listener on <app-comp-board>, so a change from any field inside would reach the host
    // as an Event where a seat write belongs — measured, not assumed. The board stops it on its own
    // root; do not delete that handler.
    fill();
    const before = host.writes;
    slot('Support')
      .querySelector<HTMLInputElement>('.board-note')!
      .dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(host.writes).toBe(before);
    expect(host.picks().Support).toBe('Nautilus');
  });

  it('ticks a fallback on the wall, so nothing can be added to two seats', () => {
    fill();
    press(fallbackPill('Support'));
    pick('Leona');
    press(slot('Top').querySelector('.board-slot-main'));
    const leona = Array.from(root().querySelectorAll<HTMLButtonElement>('.board-champ')).find(
      (b) => b.querySelector('.board-champ-label')?.textContent?.trim() === 'Leona'
    );
    expect(leona?.classList.contains('is-taken')).toBe(true);
  });
});
