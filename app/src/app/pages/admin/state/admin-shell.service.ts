import { Injectable, signal } from '@angular/core';
import { EditorTab } from '../admin-drafts';

/**
 * The page-level concerns every admin editor touches: which tab is open, the
 * status line, scrolling a row into view, and asking for the drafts to be
 * re-seeded after a create.
 *
 * It exists to break a dependency loop. AdminContextService owns the editors,
 * and the editors need to switch tabs and report — without somewhere neutral to
 * put that, they would depend on each other both ways.
 */
@Injectable()
export class AdminShellService {
  readonly status = signal('');
  readonly activeTab = signal<EditorTab>('players');

  /**
   * Bumped when an editor creates something. The context watches it so the
   * drafts re-seed from Firestore and the new row picks up its real id.
   */
  readonly resyncToken = signal(0);

  flash(message: string): void {
    this.status.set(message);
    setTimeout(() => this.status.set(''), 2500);
  }

  requestResync(): void {
    this.resyncToken.update((n) => n + 1);
  }

  /** Waits a tick so the row exists before scrolling to it. */
  scrollToCard(id: string): void {
    setTimeout(() => {
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }
}
