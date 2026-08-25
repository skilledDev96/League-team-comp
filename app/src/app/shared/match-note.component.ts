import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { TeamDataService } from '../services/team-data.service';

/**
 * Retrospective note for one played match.
 *
 * Notes are keyed by Riot match id in their own store, because analysis games
 * are rebuilt from Riot on every refresh — anything attached to the game itself
 * would silently disappear. Used anywhere a played game is listed.
 */
@Component({
  selector: 'app-match-note',
  imports: [FormsModule],
  template: `
    @if (auth.editing()) {
      <button type="button" class="prep-note-toggle" [class.on]="hasNote()"
              [title]="hasNote() ? 'Edit note' : 'Add a note'"
              (click)="toggle($event)">
        <span class="material-symbols-rounded" aria-hidden="true">sticky_note_2</span>
      </button>
    }

    @if (auth.editing() && open()) {
      <textarea class="prep-note-input" rows="3"
                [ngModel]="draft()"
                (ngModelChange)="draft.set($event)"
                (blur)="save()"
                [name]="'note-' + matchId()"
                placeholder="What worked, what went wrong, champions to swap…"></textarea>
    } @else if (hasNote()) {
      <p class="prep-note-text">{{ stored() }}</p>
    }
  `
})
export class MatchNoteComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly auth = inject(AuthService);

  readonly matchId = input.required<string>();

  protected readonly open = signal(false);
  protected readonly draft = signal<string | null>(null);

  protected stored(): string {
    return this.data.matchNote(this.matchId());
  }

  protected hasNote(): boolean {
    return Boolean(this.stored());
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    if (!this.open()) {
      this.draft.set(this.stored());
    }
    this.open.update((value) => !value);
  }

  protected save(): void {
    const text = this.draft() ?? '';
    if (text.trim() === this.stored()) {
      return;
    }
    void this.data.saveMatchNote(this.matchId(), text);
  }
}
