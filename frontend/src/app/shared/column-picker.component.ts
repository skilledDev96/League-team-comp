import { Component, computed, inject, input, signal } from '@angular/core';
import { TablePrefsService } from '../services/table-prefs.service';

export interface ColumnOption {
  key: string;
  label: string;
}

/**
 * Which columns a table shows, with a default view to fall back to. One
 * picker per table, keyed by name, remembered per browser through
 * TablePrefsService so the choice holds across pages and reloads.
 */
@Component({
  selector: 'app-column-picker',
  template: `
    <div class="team-columns">
      <button type="button" class="view-btn" [class.active]="open()" (click)="open.set(!open())">
        <span class="material-symbols-rounded" aria-hidden="true">view_column</span> Columns <small>{{ count() }}</small>
      </button>
      @if (open()) {
        <div class="team-columns-picker" role="group" aria-label="Columns to show">
          @for (o of options(); track o.key) {
            <label class="team-column-option" [class.active]="prefs.isOn(table(), o.key, defaults())">
              <input type="checkbox" [checked]="prefs.isOn(table(), o.key, defaults())" (change)="prefs.toggle(table(), o.key, defaults())" />
              {{ o.label }}
            </label>
          }
          <button type="button" class="view-btn" (click)="prefs.reset(table())">Default view</button>
        </div>
      }
    </div>
  `
})
export class ColumnPickerComponent {
  protected readonly prefs = inject(TablePrefsService);
  readonly table = input.required<string>();
  readonly options = input.required<ColumnOption[]>();
  readonly defaults = input<string[]>([]);
  protected readonly open = signal(false);
  protected readonly count = computed(() => this.prefs.visibleFor()(this.table(), this.defaults()).length);
}
