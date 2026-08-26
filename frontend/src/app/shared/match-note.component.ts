import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { MatchNoteUiService } from '../services/match-note-ui.service';
import { TeamDataService } from '../services/team-data.service';
import { NgModelNameDirective } from './ng-model-name.directive';

/**
 * Retrospective note for one played match.
 *
 * Notes are keyed by Riot match id in their own store, because analysis games
 * are rebuilt from Riot on every refresh — anything attached to the game itself
 * would silently disappear. This renders the note body; the control that opens
 * it is `app-match-note-button`, which sits up in the row header.
 */
@Component({
  selector: 'app-match-note',
  imports: [FormsModule, NgModelNameDirective],
  template: `
    @if (auth.editing() && noteUi.isOpen(matchId())) {
      <textarea class="prep-note-input" rows="3"
                [ngModel]="draft() ?? stored()"
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
  private readonly data = inject(TeamDataService);
  protected readonly noteUi = inject(MatchNoteUiService);
  protected readonly auth = inject(AuthService);

  readonly matchId = input.required<string>();

  protected readonly draft = signal<string | null>(null);

  protected stored(): string {
    return this.data.matchNote(this.matchId());
  }

  protected hasNote(): boolean {
    return Boolean(this.stored());
  }

  protected save(): void {
    const text = this.draft();
    if (text === null || text.trim() === this.stored()) {
      return;
    }
    void this.data.saveMatchNote(this.matchId(), text);
    this.draft.set(null);
  }
}
