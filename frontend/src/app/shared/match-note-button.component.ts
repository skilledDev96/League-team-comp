import { Component, inject, input } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { MatchNoteUiService } from '../services/match-note-ui.service';
import { TeamDataService } from '../services/team-data.service';
import { TooltipDirective } from './tooltip.directive';

/**
 * Opens the retrospective note for a match. Lives in the row header, next to
 * the outcome and date, so writing a note doesn't mean expanding the game and
 * hunting for an unlabelled icon — and so a row that already has one says so
 * without being opened.
 */
@Component({
  selector: 'app-match-note-button',
  imports: [TooltipDirective],
  template: `
    @if (auth.editing() || hasNote()) {
      <button type="button" class="note-btn" [class.on]="hasNote()"
              [class.editing]="editing()" [attr.aria-pressed]="editing()"
              [appTip]="hasNote() ? note() : 'Add a note'"
              (click)="toggle($event)">
        <span class="material-symbols-rounded" aria-hidden="true">sticky_note_2</span>
        <span class="note-btn-label">{{ hasNote() ? 'Note' : 'Add note' }}</span>
      </button>
    }
  `
})
export class MatchNoteButtonComponent {
  private readonly data = inject(TeamDataService);
  protected readonly noteUi = inject(MatchNoteUiService);
  protected readonly auth = inject(AuthService);

  readonly matchId = input.required<string>();

  /** The editor is open below, so the button has to read as pressed. */
  protected editing(): boolean {
    return this.auth.editing() && this.noteUi.isOpen(this.matchId());
  }

  protected note(): string {
    return this.data.matchNote(this.matchId());
  }

  protected hasNote(): boolean {
    return Boolean(this.note());
  }

  /** Opening a note also opens the panel it is written on. */
  protected toggle(event: Event): void {
    this.noteUi.toggle(this.matchId());

    if (this.noteUi.isOpen(this.matchId())) {
      const details = (event.currentTarget as HTMLElement)
        .closest('.game-entry')
        ?.querySelector('details');
      if (details) {
        details.open = true;
      }
    }
  }
}
