import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService } from '../services/champion-data.service';
import { UiService } from '../services/ui.service';

/**
 * Pick champions by name instead of typing a comma-separated list. Used
 * anywhere a set of champions is stored (pools, bans, drafted games), so the
 * spelling always matches Data Dragon and nothing depends on the user
 * remembering punctuation like "Kai'Sa".
 */
@Component({
  selector: 'app-champion-picker',
  imports: [FormsModule],
  template: `
    <div class="champ-picker">
      <div class="champ-picker-chips">
        @for (champ of champions(); track champ) {
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

      @if (max() > 0) {
        <span class="champ-picker-count">{{ champions().length }} / {{ max() }}</span>
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

  readonly championsChange = output<string[]>();

  protected readonly query = signal('');
  protected readonly open = signal(false);

  protected readonly atLimit = computed(() => {
    const cap = this.max();
    return cap > 0 && this.champions().length >= cap;
  });

  private norm(value: string): string {
    return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Name matches, already-picked removed, capped so the menu stays usable. */
  protected readonly suggestions = computed(() => {
    const q = this.norm(this.query());
    if (!q) return [];
    const taken = new Set(this.champions().map((c) => this.norm(c)));
    return this.champData
      .champions()
      .filter((c) => !taken.has(this.norm(c.name)) && this.norm(c.name).includes(q))
      .slice(0, 8);
  });

  protected onQuery(value: string): void {
    this.query.set(value);
    this.open.set(true);
  }

  protected add(name: string): void {
    if (this.atLimit()) return;
    const taken = new Set(this.champions().map((c) => this.norm(c)));
    if (taken.has(this.norm(name))) return;
    this.championsChange.emit([...this.champions(), name]);
    this.query.set('');
    this.open.set(false);
  }

  protected remove(name: string): void {
    this.championsChange.emit(this.champions().filter((c) => c !== name));
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
