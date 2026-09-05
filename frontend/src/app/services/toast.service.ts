import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'ok' | 'warn';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly title: string;
  readonly text?: string;
  /** Material Symbols name, when one helps. */
  readonly icon?: string;
}

/** How long a toast stays unless dismissed, in ms. */
const DEFAULT_TIMEOUT = 6500;

/**
 * Short, transient notices — one place for the app to say "that happened".
 *
 * Deliberately small. Anything a person has to act on belongs in the page
 * itself; this is for the things worth saying once and then getting out of the
 * way: a change was saved, a job finished on another page, edit mode saves on
 * its own. Rendered once by the app shell, so every page shares the stack.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<readonly Toast[]>([]);
  private nextId = 1;

  show(
    title: string,
    options: { text?: string; kind?: ToastKind; icon?: string; timeout?: number } = {}
  ): number {
    const id = this.nextId++;
    const toast: Toast = {
      id,
      kind: options.kind ?? 'info',
      title,
      text: options.text,
      icon: options.icon
    };
    this.toasts.update((list) => [...list, toast]);
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    if (timeout > 0) setTimeout(() => this.dismiss(id), timeout);
    return id;
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /**
   * Show a notice only the first time, keyed in localStorage.
   *
   * For the hints that are useful exactly once — after that they are noise.
   * The key is per browser rather than per account on purpose: the hint is
   * about how this interface behaves, and a person who has seen it has seen it.
   */
  once(key: string, title: string, options: Parameters<ToastService['show']>[1] = {}): boolean {
    const storageKey = `bom-hint:${key}`;
    try {
      if (localStorage.getItem(storageKey)) return false;
      localStorage.setItem(storageKey, '1');
    } catch {
      // Storage unavailable: show it anyway rather than never.
    }
    this.show(title, options);
    return true;
  }
}
