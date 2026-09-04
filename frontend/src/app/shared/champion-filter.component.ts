import { Component, computed, inject, input, signal } from '@angular/core';
import { ChampionDataService, ChampionInfo } from '../services/champion-data.service';
import { ChampionFilterService } from '../services/champion-filter.service';
import { UiService } from '../services/ui.service';

/** How many matches the menu offers; more than this is a list, not a choice. */
const MAX_SUGGESTIONS = 8;

/**
 * The one-champion filter box, the same on every page that has an answer for
 * it. The page passes what it counted and what to call it, so the line reads
 * "2 comps with Tristana" here and "5 scrims with Tristana" there.
 *
 * Its own typeahead rather than a `<datalist>`: the browser's list cannot be
 * styled, opens on every champion at once and shows no icons, which on a page
 * built around champion art reads as a bug.
 */
@Component({
  selector: 'app-champion-filter',
  template: `
    <div class="champ-filter">
      <div class="champ-filter-box">
        <label class="champ-filter-input" [class.is-set]="chosen()">
          @if (chosen(); as c) {
            <img class="champ-filter-pick" [src]="ui.championIconUrl(c.id)" [alt]="" />
          } @else {
            <span class="material-symbols-rounded" aria-hidden="true">filter_alt</span>
          }
          <input type="search" autocomplete="off" spellcheck="false"
                 [placeholder]="placeholder()"
                 aria-label="Filter by champion"
                 role="combobox" [attr.aria-expanded]="open()"
                 [value]="filter.value()"
                 (input)="onInput($any($event.target).value)"
                 (keydown)="onKey($event)"
                 (focus)="open.set(true)"
                 (blur)="open.set(false)" />
        </label>
        @if (open() && suggestions().length) {
          <ul class="champ-filter-menu" role="listbox">
            @for (c of suggestions(); track c.id; let i = $index) {
              <li class="champ-filter-option" role="option" [class.is-active]="i === highlight()"
                  [attr.aria-selected]="i === highlight()"
                  (mousedown)="$event.preventDefault(); choose(c)"
                  (mousemove)="highlight.set(i)">
                <img [src]="ui.championIconUrl(c.id)" [alt]="" loading="lazy" />
                <span>{{ c.name }}</span>
                <small>{{ c.title }}</small>
              </li>
            }
          </ul>
        }
      </div>
      @if (filter.active()) {
        <span class="champ-filter-count">
          <b>{{ count() }}</b> {{ count() === 1 ? singular() : noun() }} with {{ chosen()?.name || filter.active() }}
        </span>
      }
      @if (filter.value().trim()) {
        <button type="button" class="link-btn" (click)="filter.clear()">Clear</button>
      }
    </div>
  `
})
export class ChampionFilterComponent {
  protected readonly filter = inject(ChampionFilterService);
  protected readonly ui = inject(UiService);
  private readonly champs = inject(ChampionDataService);

  /** How many of the page's things matched. */
  readonly count = input.required<number>();
  /** Plural noun for the count line: games, comps, scrims, players. */
  readonly noun = input<string>('games');
  readonly placeholder = input<string>('One champion — Tristana, Rakan…');

  protected readonly open = signal(false);
  protected readonly highlight = signal(0);

  /** The champion the current text names exactly, if it does. */
  protected readonly chosen = computed<ChampionInfo | undefined>(() => {
    const want = this.filter.active();
    if (!want) return undefined;
    const id = this.champs.resolveId(want);
    return id ? this.champs.champions().find((c) => c.id === id) : undefined;
  });

  /**
   * Matches on what has been typed: a start-of-name match ranks first, then
   * anything containing it, so "ka" offers Kai'Sa and Karma before Akali.
   */
  protected readonly suggestions = computed<ChampionInfo[]>(() => {
    const q = norm(this.filter.value());
    if (!q) return [];
    const chosen = this.chosen();
    const all = this.champs.champions();
    const starts = all.filter((c) => norm(c.name).startsWith(q) || norm(c.id).startsWith(q));
    const within = all.filter((c) => !starts.includes(c) && (norm(c.name).includes(q) || norm(c.id).includes(q)));
    const list = [...starts, ...within].slice(0, MAX_SUGGESTIONS);
    // Exactly one match, already chosen: nothing left to offer.
    return list.length === 1 && chosen && list[0].id === chosen.id ? [] : list;
  });

  protected onInput(value: string): void {
    this.filter.set(value);
    this.highlight.set(0);
    this.open.set(true);
  }

  protected choose(c: ChampionInfo): void {
    this.filter.set(c.name);
    this.open.set(false);
  }

  protected onKey(event: KeyboardEvent): void {
    const list = this.suggestions();
    if (event.key === 'Escape') {
      this.open.set(false);
      return;
    }
    if (!list.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.open.set(true);
      this.highlight.set((this.highlight() + 1) % list.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlight.set((this.highlight() - 1 + list.length) % list.length);
    } else if (event.key === 'Enter' && this.open()) {
      event.preventDefault();
      this.choose(list[Math.min(this.highlight(), list.length - 1)]);
    }
  }

  protected singular(): string {
    const n = this.noun();
    return n.endsWith('s') ? n.slice(0, -1) : n;
  }
}

function norm(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}
