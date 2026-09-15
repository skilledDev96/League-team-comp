import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService, ChampionInfo } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';
import { NgModelNameDirective } from './ng-model-name.directive';
import { championKey } from '../core/champion-key';

export { championKey };

/**
 * Pick champions by name instead of typing a comma-separated list. Used
 * anywhere a set of champions is stored (pools, bans, drafted games), so the
 * spelling always matches Data Dragon and nothing depends on the user
 * remembering punctuation like "Kai'Sa".
 */

/**
 * Does a typed query find this champion? A substring of the key, or of the
 * key with doubled letters collapsed — "lilia" for Lillia, "anie" for Annie,
 * "kasadin" for Kassadin — because a draft is typed in a hurry and a miss was
 * silent until 5 Sep 2026.
 */
export function championMatches(name: string, query: string): boolean {
  const key = championKey(name);
  const q = championKey(query);
  if (!q) return true;
  if (key.includes(q)) return true;
  const squash = (s: string) => s.replace(/(.)\1+/g, '$1');
  return squash(key).includes(squash(q));
}

/**
 * How well a match fits what was typed, lower first: the name itself, then a name that starts with it, then the rest.
 * Enter takes the top suggestion, and in name order "Vi" was Anivia (15 Sep 2026).
 */
export function matchRank(name: string, query: string): number {
  const key = championKey(name);
  const q = championKey(query);
  if (!q || key === q) return 0;
  return key.startsWith(q) ? 1 : 2;
}

/** A new pick: the first empty seat when the list is seated and has one, else the end of the list. */
export function pickerAdd(list: readonly string[], name: string, seated: boolean): string[] {
  const clean = [...list];
  if (seated) {
    const blank = clean.findIndex((c) => !c || !c.trim());
    if (blank >= 0) {
      clean[blank] = name;
      return clean;
    }
  }
  return [...clean.filter((c) => !!c && !!c.trim()), name];
}

/** A removed pick: its seat emptied (trailing empty seats dropped) when seated, else taken out of the list. */
export function pickerRemove(list: readonly string[], name: string, seated: boolean): string[] {
  if (!seated) return list.filter((c) => c !== name && !!c && !!c.trim());
  const next = list.map((c) => (c === name ? '' : c));
  while (next.length && !next[next.length - 1]?.trim()) next.pop();
  return next;
}

@Component({
  selector: 'app-champion-picker',
  imports: [FormsModule, NgModelNameDirective],
  template: `
    <div class="champ-picker">
      <div class="champ-picker-chips">
        @for (champ of picked(); track champ) {
          <span class="champ-picker-chip">
            <img class="champ-picker-icon" [src]="ui.championIconUrl(champ)" [alt]="champ" loading="lazy" />
            <span>{{ champ }}</span>
            <button type="button" class="champ-picker-remove" [attr.aria-label]="'Remove ' + champ"
                    (click)="remove(champ)">
              <span class="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          </span>
        }
        @if (!atLimit()) {
          <input
            type="text"
            class="champ-picker-input"
            [ngModel]="query()"
            (ngModelChange)="onQuery($event)"
            (keydown.enter)="commitFirst($event)"
            (keydown.escape)="close()"
            (focus)="open.set(true)"
            [name]="inputName()"
            [placeholder]="placeholder()"
            autocomplete="off" />
        }
      </div>

      @if (open() && suggestions().length) {
        <ul class="champ-picker-menu" role="listbox">
          @for (champ of suggestions(); track champ.id) {
            <li>
              <button type="button" class="champ-picker-option" (click)="add(champ.name)">
                <img class="champ-picker-icon" [src]="ui.championIconUrl(champ.name)" [alt]="" loading="lazy" />
                <span>{{ champ.name }}</span>
              </button>
            </li>
          }
        </ul>
      }
      @if (open() && query().trim() && !suggestions().length) {
        <!-- A typo used to be silent: no menu, Enter took nothing, Save kept
             the old chips, and "Lilia" looked saved when it was not. -->
        <p class="champ-picker-none" role="status">No champion matches "{{ query().trim() }}".</p>
      }

      @if (max() > 0) {
        <span class="champ-picker-count">{{ picked().length }} / {{ max() }}</span>
      }
    </div>
  `
})
export class ChampionPickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly champData = inject(ChampionDataService);
  protected readonly ui = inject(UiService);

  readonly champions = input<string[]>([]);
  /** 0 means no cap. */
  readonly max = input<number>(0);
  readonly placeholder = input<string>('Add champion…');
  /** Distinguishes the inner input when several pickers share a form. */
  readonly inputName = input<string>('champ-picker');
  /** Optional lane, used to seed the opening suggestions. */
  readonly role = input<string>('');
  /**
   * Champions this picker must not offer — banned, already drafted, or burned
   * earlier in a fearless series. Offering one that cannot be taken is worse
   * than useless mid-draft.
   */
  readonly unavailable = input<string[]>([]);

  /**
   * The list is five seats in role order, as the draft room saves a game (15 Sep 2026): an empty name is a seat nobody
   * has picked yet. The picker draws and counts only the champions, a new pick fills the first empty seat, and
   * removing one empties its seat rather than shifting the champions after it into the wrong roles. A draft
   * abandoned half way used to show broken chips for the empty seats and count them towards the five.
   */
  readonly seated = input(false);

  readonly championsChange = output<string[]>();

  /** The champions only: an empty seat is not a pick. */
  protected readonly picked = computed(() => this.champions().filter((c) => !!c && !!c.trim()));

  protected readonly query = signal('');
  protected readonly open = signal(false);

  protected readonly atLimit = computed(() => {
    const cap = this.max();
    return cap > 0 && this.picked().length >= cap;
  });

  private norm(value: string): string {
    return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Riot tags aren't lanes, but they narrow the opening list enough to be a
   * useful starting point when we know the role a pool is being built for.
   */
  private static readonly ROLE_TAGS: Record<string, string[]> = {
    Top: ['Fighter', 'Tank'],
    Jungle: ['Fighter', 'Assassin', 'Tank'],
    Mid: ['Mage', 'Assassin'],
    ADC: ['Marksman'],
    Support: ['Support', 'Tank', 'Mage']
  };

  /**
   * Every champion that isn't already picked — the menu scrolls, so there's no
   * reason to truncate and hide options. With an empty box, champions that suit
   * the role float to the top instead of the rest being filtered out.
   */
  protected readonly suggestions = computed(() => {
    const q = this.norm(this.query());
    const taken = new Set([...this.picked(), ...this.unavailable()].map((c) => this.norm(c)));
    const all = this.champData.champions().filter((c) => !taken.has(this.norm(c.name)));
    const byName = (a: ChampionInfo, b: ChampionInfo) => a.name.localeCompare(b.name);

    if (q) {
      return all
        .filter((c) => championMatches(c.name, q))
        .sort((a, b) => matchRank(a.name, q) - matchRank(b.name, q) || byName(a, b));
    }

    const tags = ChampionPickerComponent.ROLE_TAGS[this.role()] ?? [];
    if (!tags.length) {
      return [...all].sort(byName);
    }
    const suits = (c: ChampionInfo) => c.tags.some((t) => tags.includes(t));
    return [
      ...all.filter(suits).sort(byName),
      ...all.filter((c) => !suits(c)).sort(byName)
    ];
  });

  protected onQuery(value: string): void {
    this.query.set(value);
    this.open.set(true);
  }

  protected add(name: string): void {
    if (this.atLimit()) return;
    const taken = new Set([...this.picked(), ...this.unavailable()].map((c) => this.norm(c)));
    if (taken.has(this.norm(name))) return;
    this.championsChange.emit(pickerAdd(this.champions(), name, this.seated()));
    this.query.set('');
    this.open.set(false);
  }

  protected remove(name: string): void {
    this.championsChange.emit(pickerRemove(this.champions(), name, this.seated()));
  }

  /** Enter picks the top suggestion, so the list never needs the mouse. */
  protected commitFirst(event: Event): void {
    const first = this.suggestions()[0];
    if (first) {
      event.preventDefault();
      this.add(first.name);
    }
  }

  protected close(): void {
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
