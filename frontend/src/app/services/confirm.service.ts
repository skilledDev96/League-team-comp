import { Injectable, signal } from '@angular/core';

/** What a confirmation asks: the question, what goes, and the words on the button that does it. */
export interface ConfirmRequest {
  /** The question, as a sentence: "Delete the series against 5s?" */
  title: string;
  /** What is lost, or what happens next. Optional. */
  body?: string;
  /** The button that goes ahead, named for what it does: "Delete series", never "OK". */
  confirmLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** A destructive action: the button wears the warning colour. */
  danger?: boolean;
}

/**
 * Every "are you sure?" in the app, drawn by the app (15 Sep 2026).
 *
 * The lead deleted a whole scrim block with no dialog at all: every delete called the browser's
 * `window.confirm`, and a browser that suppresses page dialogs answers it on its own. Nothing in the
 * page could tell. So a confirmation is now the app's own native `<dialog>` (the one
 * `ConfirmDialogComponent`, mounted once in the shell): it always shows, it opens with Cancel focused
 * so Enter never deletes, and Escape or a click on the backdrop cancels.
 *
 * `ask` resolves true only when the person pressed the confirm button. A second `ask` while one is
 * open cancels the first rather than stacking dialogs.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly request = signal<(ConfirmRequest & { id: number }) | null>(null);
  private resolver: ((ok: boolean) => void) | null = null;
  private nextId = 1;

  ask(request: ConfirmRequest): Promise<boolean> {
    this.settle(false);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
      this.request.set({ ...request, id: this.nextId++ });
    });
  }

  /** The dialog's answer: true only from the confirm button. */
  answer(ok: boolean): void {
    this.settle(ok);
  }

  private settle(ok: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.request.set(null);
    resolve?.(ok);
  }
}
