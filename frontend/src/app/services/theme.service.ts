import { Injectable, signal } from '@angular/core';

export type Theme = 'dark' | 'dark-blue' | 'dark-red' | 'hextech' | 'void' | 'light';

const THEMES: Theme[] = ['dark', 'dark-blue', 'dark-red', 'hextech', 'void', 'light'];
const STORAGE_KEY = 'bom-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly themes = THEMES;
  readonly current = signal<Theme>('dark-blue');

  constructor() {
    this.applyTheme(this.preferredTheme());
  }

  private isValid(theme: string | null): theme is Theme {
    return theme !== null && THEMES.includes(theme as Theme);
  }

  themeLabel(theme: Theme): string {
    if (theme === 'dark') return 'Dark';
    if (theme === 'dark-red') return 'Red';
    if (theme === 'hextech') return 'Hextech';
    if (theme === 'void') return 'Void';
    if (theme === 'light') return 'Light';
    return 'Blue';
  }

  private getStoredTheme(): Theme | null {
    const stored = localStorage.getItem(STORAGE_KEY);
    return this.isValid(stored) ? stored : null;
  }

  preferredTheme(): Theme {
    const stored = this.getStoredTheme();
    if (stored) {
      return stored;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-blue' : 'light';
  }

  applyTheme(theme: Theme): void {
    const selected = this.isValid(theme) ? theme : 'dark';
    document.body.setAttribute('data-theme', selected);
    localStorage.setItem(STORAGE_KEY, selected);
    this.current.set(selected);
  }
}
