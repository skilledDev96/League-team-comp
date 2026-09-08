import { Component, effect, ElementRef, HostListener, inject, viewChild } from '@angular/core';
import { PlayerEditorService } from '../services/player-editor.service';
import { PlayerAvatarComponent } from './player-avatar.component';
import { PlayerEditorComponent } from './player-editor.component';

/**
 * The player editor as a drawer over any page. Hosted once at the app root,
 * because a card carries a transform and would re-root a fixed child.
 * Escape and the scrim close it; everything inside saves as it is typed.
 */
@Component({
  selector: 'app-player-editor-drawer',
  imports: [PlayerAvatarComponent, PlayerEditorComponent],
  template: `
    @if (editor.drawerDraft(); as draft) {
      <div class="drawer-scrim" (click)="editor.close()"></div>
      <aside class="drawer player-drawer" role="dialog" aria-modal="true" [attr.aria-label]="'Edit ' + (draft.name || 'player')" tabindex="-1" #panel>
        <header class="drawer-head">
          <app-player-avatar [name]="draft.name" [icon]="draft.icon" [role]="draft.role" />
          <div class="drawer-title">
            <strong>{{ draft.name || 'Player' }}</strong>
            <small class="muted">Saves as you type, for everyone.</small>
          </div>
          <button type="button" class="view-btn drawer-close" (click)="editor.close()" aria-label="Close">
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </header>
        <div class="drawer-body">
          @defer (on immediate) { <app-player-editor [draft]="draft" /> }
        </div>
      </aside>
    }
  `
})
export class PlayerEditorDrawerComponent {
  protected readonly editor = inject(PlayerEditorService);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    effect(() => {
      if (this.editor.drawerDraft()) setTimeout(() => this.panel()?.nativeElement.focus(), 0);
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.editor.drawerDraft()) this.editor.close();
  }
}
