import { Injectable, computed, signal } from '@angular/core';

/**
 * How the stat tables read: one figure over every game, or wins beside
 * losses. The team asked for the plain figure by default and the
 * comparison on request (8 Sep 2026).
 */
export type SplitView = 'all' | 'wl';

const VIEW_KEY = 'bom-split-view';
const COLUMNS_KEY = 'bom-table-columns';

/**
 * What every stat table remembers per browser: the split view, and which
 * columns each table shows. Shared so the player card and the Patterns
 * tables read the same way, and so a choice made on one page holds on the
 * next. Storage may be blocked; then the choice lasts for the page.
 */
@Injectable({ providedIn: 'root' })
export class TablePrefsService {
  readonly view = signal<SplitView>(this.storedView());
  private readonly columns = signal<Record<string, string[]>>(this.storedColumns());

  private storedView(): SplitView {
    try {
      return localStorage.getItem(VIEW_KEY) === 'wl' ? 'wl' : 'all';
    } catch {
      return 'all';
    }
  }

  private storedColumns(): Record<string, string[]> {
    try {
      const raw = localStorage.getItem(COLUMNS_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  }

  setView(view: SplitView): void {
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // The choice lasts for the page instead.
    }
  }

  /** The keys a table shows: its own choice, else its defaults. */
  visible(table: string, defaults: readonly string[]): string[] {
    return this.columns()[table] ?? [...defaults];
  }

  readonly visibleFor = computed(() => (table: string, defaults: readonly string[]) => this.visible(table, defaults));

  isOn(table: string, key: string, defaults: readonly string[]): boolean {
    return this.visible(table, defaults).includes(key);
  }

  toggle(table: string, key: string, defaults: readonly string[]): void {
    const now = this.visible(table, defaults);
    const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
    this.columns.update((all) => ({ ...all, [table]: next }));
    this.persistColumns();
  }

  reset(table: string): void {
    this.columns.update((all) => {
      const next = { ...all };
      delete next[table];
      return next;
    });
    this.persistColumns();
  }

  private persistColumns(): void {
    try {
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(this.columns()));
    } catch {
      // Same: the page keeps it, the browser does not.
    }
  }
}
