import { Injectable, computed, inject, signal } from '@angular/core';
import { ChampionDataService } from './champion-data.service';

const STORAGE_KEY = 'bom-champ-filter';

/**
 * One champion, followed across pages.
 *
 * "Where does Tristana sit?" is asked of the comps, the games, the scrims and
 * both rosters, and the answer is only useful if the same name carries from
 * one page to the next — so the value lives here, not on a page. Every page
 * that shows `<app-champion-filter>` reads and writes this one signal, and it
 * survives a reload of the tab.
 *
 * Names are compared by Riot id: the games and scrims carry `MonkeyKing`, a
 * person types Wukong, and both resolve to one key before they meet.
 */
@Injectable({ providedIn: 'root' })
export class ChampionFilterService {
  private readonly champs = inject(ChampionDataService);

  readonly value = signal(readStored());

  /** The trimmed champion, or '' when nothing is being filtered. */
  readonly active = computed(() => this.value().trim());

  /** Names for the dropdown, as people know them. */
  readonly names = computed(() => this.champs.champions().map((c) => c.name));

  set(value: string): void {
    this.value.set(value);
    try {
      if (value.trim()) sessionStorage.setItem(STORAGE_KEY, value);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the filter still works for this page.
    }
  }

  clear(): void {
    this.set('');
  }

  key(name: string): string {
    return (this.champs.resolveId(name) ?? name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  /** True when a filter is active and `champion` is the one being asked about. */
  matches(champion: string | null | undefined): boolean {
    const want = this.active();
    return !!want && !!champion && this.key(champion) === this.key(want);
  }

  /** True when no filter is active, or any of these champions is the one. */
  passes(champions: readonly (string | null | undefined)[]): boolean {
    if (!this.active()) return true;
    return champions.some((c) => this.matches(c));
  }
}

function readStored(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}
