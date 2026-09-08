import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ROLES } from '../models/team.models';
import { PlayerDraft } from '../pages/admin/admin-drafts';
import { PlayerEditorService } from '../services/player-editor.service';
import { ChampionPickerComponent } from './champion-picker.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * The player form: every field a player has, saving as it is typed.
 *
 * One form for Admin's panel and for the drawer on the profile and the
 * roster, so the labels, the toggles and the save path are the same wherever
 * a player is edited. Text fields report through input/change; the toggles
 * and pickers call the autosave directly because a click is not an input.
 */
@Component({
  selector: 'app-player-editor',
  imports: [FormsModule, ChampionPickerComponent, TooltipDirective],
  template: `
    @let draft = this.draft();
    <div class="player-panel-body player-editor" (input)="editor.autosave(draft)" (change)="editor.autosave(draft)">
      <div data-tour="pe-identity" class="grid two">
        <label class="field"><span>Summoner name</span>
          <input type="text" required [ngModel]="draft.name" (ngModelChange)="draft.name = $event" [name]="'pname-' + draft.uid" placeholder="e.g. DaWhiteHammer" /></label>
        <label class="field"><span>Riot tag</span>
          <input type="text" [ngModel]="draft.riotTag" (ngModelChange)="draft.riotTag = $event" [name]="'ptag-' + draft.uid" placeholder="EUW" /></label>
      </div>
      <div class="grid two">
        <label class="field"><span>Role</span>
          <select [ngModel]="draft.role" (ngModelChange)="draft.role = $event" [name]="'prole-' + draft.uid">
            @for (role of roles; track role) { <option [value]="role">{{ role }}</option> }
          </select></label>
        <div data-tour="pe-bench" class="field"><span>A team</span>
          <button type="button" class="ateam-toggle" [class.is-bench]="draft.sub" [attr.aria-pressed]="draft.sub"
                  [appTip]="draft.sub ? 'On the bench — click to put them in the A team' : 'In the A team — click to bench them. The A team is the five Patterns counts and the draft room follows.'"
                  (click)="draft.sub = !draft.sub; editor.autosave(draft)">{{ draft.sub ? 'Bench' : 'A team' }}</button>
        </div>
      </div>
      <div class="field"><span>2nd seats</span>
        <div class="role-flex-group">
          @for (role of roles; track role) {
            @if (role !== draft.role) {
              <button type="button" class="role-flex-toggle" [class.on]="draft.secondaryRoles.includes(role)"
                      (click)="editor.toggleSecondaryRole(draft, role); editor.autosave(draft)">{{ role }}</button>
            }
          }
        </div>
      </div>
      <div data-tour="pe-pool" class="field"><span>Champion pool</span>
        <app-champion-picker [champions]="editor.listOf(draft.top3)" [role]="draft.role"
                             [inputName]="'ptop-' + draft.uid" placeholder="Add a champion…"
                             (championsChange)="draft.top3 = $event.join(', '); editor.autosave(draft)" />
        <small class="field-hint">The first champion is shown as the main.</small>
      </div>
      <div class="field"><span>Bans</span>
        <app-champion-picker [champions]="editor.listOf(draft.bans)"
                             [inputName]="'pbans-' + draft.uid" placeholder="Add a ban…"
                             (championsChange)="draft.bans = $event.join(', '); editor.autosave(draft)" />
      </div>
      <label class="field"><span>Playstyle</span>
        <input type="text" [ngModel]="draft.playstyle" (ngModelChange)="draft.playstyle = $event" [name]="'pstyle-' + draft.uid" /></label>
      <label class="field"><span>Strengths <small class="muted">comma separated</small></span>
        <input type="text" [ngModel]="draft.strengths" (ngModelChange)="draft.strengths = $event" [name]="'pstr-' + draft.uid" /></label>
      <label class="field"><span>Weaknesses <small class="muted">comma separated</small></span>
        <input type="text" [ngModel]="draft.weaknesses" (ngModelChange)="draft.weaknesses = $event" [name]="'pweak-' + draft.uid" /></label>

      <details class="intel-collapse player-editor-more">
        <summary><span class="material-symbols-rounded" aria-hidden="true">tune</span>Links and icon</summary>
        <div class="grid two">
          <label class="field"><span>Region</span>
            <input type="text" [ngModel]="draft.region" (ngModelChange)="draft.region = $event" [name]="'preg-' + draft.uid" /></label>
          <label class="field"><span>Icon file <small class="muted">name.webp</small></span>
            <input type="text" [ngModel]="draft.icon" (ngModelChange)="draft.icon = $event" [name]="'picon-' + draft.uid" placeholder="name.webp" /></label>
          <label class="field"><span>OP.GG slug</span>
            <input type="text" [ngModel]="draft.opggSlug" (ngModelChange)="draft.opggSlug = $event" [name]="'popgg-' + draft.uid" /></label>
          <label class="field"><span>Mobalytics slug</span>
            <input type="text" [ngModel]="draft.mobalyticsSlug" (ngModelChange)="draft.mobalyticsSlug = $event" [name]="'pmoba-' + draft.uid" /></label>
        </div>
        <small class="field-hint">Filled from the name and tag when left blank.</small>
      </details>

      <div class="links player-editor-actions">
        <button data-tour="pe-refresh" class="view-btn" type="button" [disabled]="editor.enrichingKey() === editor.enrichmentKey(draft)" (click)="refresh()"
                appTip="Re-reads rank, recent champions and the observed playstyle from Riot. Text, pool and bans you set by hand are kept.">
          @if (editor.enrichingKey() === editor.enrichmentKey(draft)) {
            <span class="btn-spinner" aria-hidden="true"></span> Refreshing…
          } @else {
            <span class="material-symbols-rounded" aria-hidden="true">sync</span> Refresh this player from Riot
          }
        </button>
        @if (draft.curated) {
          <span data-tour="pe-hand-edited" class="pp-role flex" appTip="Saved by hand: the morning refresh keeps this player’s text, pool and bans. Refresh this player from Riot pulls Riot’s again.">Hand-edited</span>
        }
        @if (note()) { <span class="tag good" role="status">{{ note() }}</span> }
      </div>
    </div>
  `
})
export class PlayerEditorComponent {
  protected readonly editor = inject(PlayerEditorService);
  protected readonly roles = ROLES;

  readonly draft = input.required<PlayerDraft>();
  /** The line the refresh came back with, for a host that shows status its own way. */
  readonly refreshed = output<string>();

  protected readonly note = signal('');

  protected async refresh(): Promise<void> {
    const draft = this.draft();
    const message = await this.editor.refreshFromRiot(draft);
    if (!message) return;
    this.note.set(message);
    this.refreshed.emit(message);
    setTimeout(() => this.note.set(''), 4000);
    this.editor.autosave(draft);
  }
}
