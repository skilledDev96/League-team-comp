import { Injectable, signal } from '@angular/core';

/**
 * Which match notes are currently being edited.
 *
 * The toggle sits in a row header while the textarea sits in the body below it
 * — two places in the template, sometimes on opposite sides of a `<details>` —
 * so the open state cannot live inside either component. It is view state
 * only; the note text itself belongs to `TeamDataService`.
 */
@Injectable({ providedIn: 'root' })
export class MatchNoteUiService {
  private readonly openIds = signal<ReadonlySet<string>>(new Set());

  isOpen(matchId: string): boolean {
    return this.openIds().has(matchId);
  }

  toggle(matchId: string): void {
    this.openIds.update((ids) => {
      const next = new Set(ids);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  }

  close(matchId: string): void {
    this.openIds.update((ids) => {
      const next = new Set(ids);
      next.delete(matchId);
      return next;
    });
  }
}
