import { Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { ActivityService } from '../services/activity.service';
import { AuthService } from '../services/auth.service';
import { TeamDataService } from '../services/team-data.service';
import { TeamScopeService } from '../services/team-scope.service';
import { ToastService } from '../services/toast.service';
import { UserPrefsService } from '../services/user-prefs.service';

/** One line of the Team group: the root team first, for a root member, then every team the person may see by name. */
export interface TeamMenuRow {
  id: string;
  name: string;
  active: boolean;
}

/**
 * The account chip in the topbar, doubling as the entry point for admin pages.
 * Those used to hide behind a gear icon that only appeared in edit mode, which
 * made them hard to find; a persistent menu on the user chip is where people
 * already look for account and admin actions.
 *
 * Since 27 Sep 2026 (release 2, Stage 3c) the panel opens with the Team group:
 * the switcher between Bom Squad, on the root paths, and every team in the root
 * `teams` list, drawn only in Firebase mode and only when there is a team to
 * switch to or a root admin who could make one ("New team…" goes to Admin ›
 * Teams). Since release 3 (the same day) the rows are the teams this person may
 * see: the root only for a member of Bom Squad's own list, and the teams their
 * index names, or every team for a root admin. The default team's menu is
 * therefore exactly what it was: Bom Squad alone, for anyone who is not a root
 * admin, draws no group at all. The panel is a popover over the page, so nothing
 * in the topbar or on any page moves with it.
 *
 * A switch is three steps in an order that matters. First the page: the draft
 * room writes the game it is on and Patterns keeps the storage key it captured
 * at construction, both over the team that was active when they were built, so
 * the app goes to Home before the scope moves and neither can write under the
 * new team (a person already on Home stays there: the router answers false to
 * a navigation to the page it is on, and that is no page refusing to close).
 * Then `scope.choose`, which every listener and path follows, and
 * last the person's document (`prefs.setTeam`), so another device lands on the
 * same team. A job on the Activity board refuses the switch outright: it is
 * writing to the team it started on, and would otherwise finish on this one.
 */
@Component({
  selector: 'app-user-menu',
  imports: [RouterLink],
  template: `
    <div class="user-menu">
      <button type="button" class="user-chip user-chip-trigger" data-tour="user-menu-trigger" [class.active]="open()"
              [attr.aria-expanded]="open()" aria-haspopup="menu"
              (click)="toggle($event)">
        <span class="user-avatar" aria-hidden="true">{{ (email() || '?').charAt(0).toUpperCase() }}</span>
        <span class="user-name">{{ email() }}</span>
        @if (role()) { <span class="tag good">{{ role() }}</span> }
        <span class="material-symbols-rounded user-menu-chevron" aria-hidden="true">expand_more</span>
      </button>
      @if (open()) {
        <div class="user-menu-panel" role="menu" (click)="close()">
          @if (showTeams()) {
            <div class="user-menu-group" role="group" aria-labelledby="user-menu-team-label">
              <span class="user-menu-group-label" id="user-menu-team-label">Team</span>
              @for (row of teamRows(); track row.id) {
                <button type="button" class="overflow-item user-menu-team" [id]="'user-menu-team-' + row.id"
                        [class.is-current]="row.active" [attr.aria-current]="row.active ? 'true' : null"
                        (click)="switchTo(row)">
                  <span class="user-menu-team-name">{{ row.name }}</span>
                  @if (row.active) { <span class="material-symbols-rounded user-menu-check" aria-hidden="true">check</span> }
                </button>
              }
              @if (canCreate()) {
                <a class="overflow-item" id="user-menu-new-team" routerLink="/admin" [queryParams]="{ tab: 'teams' }">New team…</a>
              }
            </div>
            <span class="user-menu-sep" aria-hidden="true"></span>
          }
          <ng-content />
        </div>
      }
    </div>
  `
})
export class UserMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly data = inject(TeamDataService);
  private readonly auth = inject(AuthService);
  private readonly scope = inject(TeamScopeService);
  private readonly prefs = inject(UserPrefsService);
  private readonly activity = inject(ActivityService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly email = input<string>('');
  readonly role = input<string>('');

  protected readonly open = signal(false);

  /** New team… is Admin › Teams' door, and a team is a root admin's to create. */
  protected readonly canCreate = computed(() => this.auth.isRootAdmin());
  protected readonly teamRows = computed<TeamMenuRow[]>(() => {
    const active = this.scope.activeTeamId();
    const root: TeamMenuRow = { id: DEFAULT_TEAM_ID, name: this.data.rootTeamName(), active: active === DEFAULT_TEAM_ID };
    const rest = [...this.data.visibleTeams()]
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .map<TeamMenuRow>((t) => ({ id: t.id, name: t.name, active: t.id === active }));
    return [...(this.auth.isRootMember() ? [root] : []), ...rest];
  });
  /** The Team group draws only where there is a choice to make, or a root admin who could make one. */
  protected readonly showTeams = computed(() => this.data.mode === 'firebase' && (this.teamRows().length > 1 || this.canCreate()));

  protected toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }

  /**
   * The switch: refuse while a job runs, leave the page for Home, choose the scope, remember it.
   * The active row is a no-op, so the check mark is not a way to break anything.
   */
  protected async switchTo(row: TeamMenuRow): Promise<void> {
    if (row.active) return;
    if (this.refuseForJob()) return;
    // Home first, before the scope moves: the page showing may hold the old team's key or game. Already on Home
    // there is nothing to leave, and no navigation is asked for: the router resolves false for the URL it is on
    // (onSameUrlNavigation is 'ignore'), and read as a refusal that made every switch from the landing page fail.
    let left: boolean;
    if (this.onHome()) {
      left = true;
    } else {
      try {
        left = await this.router.navigateByUrl('/home');
      } catch {
        left = false;
      }
    }
    if (!left) {
      this.toast.show('The page would not close, so the team was not switched', { kind: 'warn', icon: 'warning' });
      return;
    }
    // The navigation was a moment; a job could have started in it, and it too is pinned to the team it saw.
    if (this.refuseForJob()) return;
    try {
      this.scope.choose(row.id);
    } catch (error) {
      this.toast.show('That team could not be opened', { kind: 'warn', icon: 'warning', text: error instanceof Error ? error.message : undefined });
      return;
    }
    try {
      await this.prefs.setTeam(row.id);
    } catch {
      // The choice holds on this device; the document is corrected on the next switch.
    }
    this.toast.show(`Switched to ${row.name}`, { kind: 'ok', icon: 'check_circle' });
  }

  /** True, with the notice shown, while a job on the Activity board is writing to the team it started on. */
  private refuseForJob(): boolean {
    const job = this.activity.primary();
    if (!job) return false;
    this.toast.show(`Wait for ${job.label} to finish before switching teams`, {
      kind: 'info',
      icon: 'hourglass_top',
      text: 'It is writing to the team it started on, and a switch now would stop it.'
    });
    return true;
  }

  /** True while the page showing is Home, whatever its query or fragment. */
  private onHome(): boolean {
    return this.router.url.split(/[?#]/)[0] === '/home';
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
