import { Injectable, signal } from '@angular/core';

/**
 * The themes on offer.
 *
 * `bomb` is the team's own mark and the default. The rest are League's regions
 * — each one a palette the game already taught people to read — plus `light`
 * for a bright room. The generic Dark / Blue / Red set that used to sit beside
 * them was three shades of the same idea and said nothing about the game.
 */
export type Theme =
  | 'bomb'
  | 'hextech'
  | 'demacia'
  | 'noxus'
  | 'freljord'
  | 'ionia'
  | 'shadow-isles'
  | 'shurima'
  | 'void'
  | 'light';

const THEMES: Theme[] = [
  'bomb',
  'hextech',
  'demacia',
  'noxus',
  'freljord',
  'ionia',
  'shadow-isles',
  'shurima',
  'void',
  'light'
];

const LABELS: Record<Theme, string> = {
  bomb: 'Bomb Squad',
  hextech: 'Hextech',
  demacia: 'Demacia',
  noxus: 'Noxus',
  freljord: 'Freljord',
  ionia: 'Ionia',
  'shadow-isles': 'Shadow Isles',
  shurima: 'Shurima',
  void: 'Void',
  light: 'Light'
};

/**
 * Where a retired theme's users land. Each maps to the region closest to what
 * they had chosen, so nobody opens the app to a palette they did not pick.
 */
const RETIRED: Record<string, Theme> = {
  dark: 'bomb',
  'dark-blue': 'freljord',
  'dark-red': 'noxus'
};

const STORAGE_KEY = 'bom-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly themes = THEMES;
  readonly current = signal<Theme>('bomb');

  constructor() {
    this.applyTheme(this.preferredTheme());
  }

  private isValid(theme: string | null): theme is Theme {
    return theme !== null && THEMES.includes(theme as Theme);
  }

  themeLabel(theme: Theme): string {
    return LABELS[theme] ?? theme;
  }

  private getStoredTheme(): Theme | null {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (this.isValid(stored)) return stored;
    if (stored && RETIRED[stored]) return RETIRED[stored];
    return null;
  }

  preferredTheme(): Theme {
    const stored = this.getStoredTheme();
    if (stored) {
      return stored;
    }
    // The team's own theme is the default; a stored choice still wins.
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'bomb' : 'light';
  }

  applyTheme(theme: Theme): void {
    const selected = this.isValid(theme) ? theme : 'bomb';
    document.body.setAttribute('data-theme', selected);
    localStorage.setItem(STORAGE_KEY, selected);
    this.current.set(selected);
  }
}
