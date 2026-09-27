import { computed, inject, Injectable, signal } from '@angular/core';
import { REGION_CODES } from '../../../core/riot-id';
import { newTeamId, slugTeamName } from '../../../core/team-id';
import { DEFAULT_TEAM_ID } from '../../../core/team-scope';
import { Team } from '../../../models/team.models';
import { ActivityService } from '../../../services/activity.service';
import { AuthService } from '../../../services/auth.service';
import { ConfirmService } from '../../../services/confirm.service';
import { RosterImportPreview, RosterImportService } from '../../../services/roster-import.service';
import { TeamDataService } from '../../../services/team-data.service';
import { TeamScopeService } from '../../../services/team-scope.service';
import { UserPrefsService } from '../../../services/user-prefs.service';
import { importPreviewLine } from './admin-players.service';
import { AdminShellService } from './admin-shell.service';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One row of the list on Admin › Teams: the root team first, as the default, then every team document. */
export interface TeamRow {
  id: string;
  name: string;
  /** A region code, or null for the root team, whose document does not exist to hold one. */
  region: string | null;
  createdBy: string | null;
  /** ISO, or null for the root team. */
  createdAt: string | null;
  isDefault: boolean;
  /** The team the person is on right now. */
  active: boolean;
}

/** How long to wait for a team's data after a switch before going on without it. */
export const SCOPE_WAIT_MS = 10000;
const SCOPE_POLL_MS = 50;

/** The list: the root team first as the default, then the team documents by name. */
export function teamRows(rootName: string, teams: readonly Team[], activeTeamId: string): TeamRow[] {
  const root: TeamRow = {
    id: DEFAULT_TEAM_ID,
    name: rootName,
    region: null,
    createdBy: null,
    createdAt: null,
    isDefault: true,
    active: activeTeamId === DEFAULT_TEAM_ID
  };
  const rest = [...teams]
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .map<TeamRow>((t) => ({
      id: t.id,
      name: t.name,
      region: t.region ?? null,
      createdBy: t.createdBy ?? null,
      createdAt: t.createdAt ?? null,
      isDefault: false,
      active: t.id === activeTeamId
    }));
  return [root, ...rest];
}

/** The Create pill's label: the count it would import, or plain while there is nothing to count. */
export function createTeamLabel(preview: RosterImportPreview): string {
  return preview.creates.length ? `Create team and import ${plural(preview.creates.length, 'player', 'players')}` : 'Create team and import players';
}

/**
 * Why the Create pill is off, or null when a team can be created: a disabled pill with no reason is a
 * mechanism that silently does nothing. Checked in the order a person fills the fold, so the tip names
 * the next thing to do rather than the last.
 */
export function createTeamReason(input: {
  mode: 'firebase' | 'local';
  admin: boolean;
  creating: boolean;
  name: string;
  /** Every name already taken, the root team's included. */
  taken: readonly string[];
  paste: string;
  preview: RosterImportPreview;
  /** The label of the job on the Activity board, or null. */
  runningJob: string | null;
  /** The importer's own refusal, which knows about the jobs that are not on the board. */
  importBlocker: string | null;
}): string | null {
  if (input.mode !== 'firebase') return 'Teams need Firebase; the local preview has one team.';
  if (!input.admin) return 'Only an admin can create a team.';
  if (input.creating) return 'A team is being created; wait for it.';
  const name = input.name.trim();
  if (!name) return 'Give the team a name.';
  if (!slugTeamName(name)) return 'The name needs at least one letter or digit.';
  if (input.taken.some((t) => t.trim().toLowerCase() === name.toLowerCase())) return `A team called ${name} already exists.`;
  if (!input.paste.trim()) return 'Paste their op.gg link or Riot IDs first.';
  if (input.preview.refused) return input.preview.refused;
  if (!input.preview.creates.length) return 'Nothing in the paste reads as a Riot ID; check the tags.';
  if (input.runningJob) return `${input.runningJob} is running; wait for it to finish, the import spends the same Riot calls.`;
  if (input.importBlocker) return input.importBlocker;
  return null;
}

/**
 * Why Switch to is off for every team but the active one, or null. A running job writes to whichever
 * prefix is active, so a switch under it would land the rest of an import, a scout or a refresh on the
 * wrong team, the root included.
 */
export function switchTeamReason(runningJob: string | null): string | null {
  return runningJob ? `${runningJob} is running; switching teams would leave it writing to the wrong one. Wait for it to finish.` : null;
}

/** "27 Sep 2026" from an ISO stamp, for the row; the stamp itself when it does not parse. */
export function createdLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Admin › Teams (27 Sep 2026, release 2, Stage 3): the list of teams, the switch, the delete guard,
 * and the fold that creates a team from an op.gg multi-link. Provided on AdminComponent like
 * AdminPlayersService, so the half-typed form dies with the page.
 *
 * Creating is one order of operations, and the order is the point: the batch that writes the team's
 * documents goes first (TeamDataService.createTeam, which builds the paths over the NEW id), then the
 * scope switches to it and the person's preference follows, then this waits for the empty players
 * snapshot to settle `ready` under the new prefix, and only then does the roster importer run, so its
 * createPlayer lands under `teams/{id}/players` and never on the root. Bom Squad is the default team,
 * has no document, and nothing here can write to it: the importer runs only once the scope is the
 * new team, and Switch to is off while any job is on the Activity board.
 */
@Injectable()
export class AdminTeamsService {
  private readonly data = inject(TeamDataService);
  private readonly auth = inject(AuthService);
  private readonly scope = inject(TeamScopeService);
  private readonly prefs = inject(UserPrefsService);
  private readonly confirm = inject(ConfirmService);
  private readonly activity = inject(ActivityService);
  private readonly shell = inject(AdminShellService);
  /** Public: the tab reads its progress, rows and blocker off the service, as Admin › Players does. */
  readonly importer = inject(RosterImportService);

  /** The region select's choices: the eleven codes `core/riot-id.ts` knows, labelled the way op.gg prints them. */
  readonly regions = REGION_CODES.map((code) => ({ code, label: code.toUpperCase() }));

  readonly rows = computed(() => teamRows(this.data.rootTeamName(), this.data.teams(), this.scope.activeTeamId()));

  // ---- The New team fold ------------------------------------------------

  readonly newName = signal('');
  readonly newRegion = signal('euw');
  /** The paste. Kept across a cancelled question, so nobody pastes twice. */
  readonly newPaste = signal('');
  /** What the paste would do on a roster that does not exist yet: planned against no players at all. */
  readonly newPreview = computed(() => this.importer.preview(this.newPaste(), []));
  readonly newLine = computed(() => importPreviewLine(this.newPreview()));
  readonly createLabel = computed(() => createTeamLabel(this.newPreview()));
  /** True from the question's yes until the importer has been handed the paste. */
  readonly creating = signal(false);

  /** The job on the Activity board, by its label, or null: the reason both pills give when one is running. */
  private readonly runningJob = computed(() => this.activity.primary()?.label ?? null);

  readonly createReason = computed(() =>
    createTeamReason({
      mode: this.data.mode,
      admin: this.auth.canManageUsers(),
      creating: this.creating(),
      name: this.newName(),
      taken: this.rows().map((r) => r.name),
      paste: this.newPaste(),
      preview: this.newPreview(),
      runningJob: this.runningJob(),
      importBlocker: this.importer.blocker()
    })
  );
  readonly switchReason = computed(() => switchTeamReason(this.runningJob()));

  private flash(message: string): void {
    this.shell.flash(message);
  }

  createdLabel(row: TeamRow): string {
    return row.createdAt ? createdLabel(row.createdAt) : '';
  }

  /**
   * Create the team and import its roster. The steps, in order, and why: ask; the batch (its own
   * documents, nothing under the root); choose the scope and remember it for this person; wait for the
   * new prefix to be ready (bounded); hand the paste to the importer, whose own question is skipped
   * because the roster is empty; re-seed the admin drafts. A step that fails stops the rest and says so
   * on the status line. The pill was disabled while a job ran, and the check runs again after the
   * question, since the dialog does not block the page.
   */
  async createTeam(): Promise<void> {
    const refused = this.createReason();
    if (refused) {
      this.flash(refused);
      return;
    }
    const name = this.newName().trim();
    const region = this.newRegion();
    const text = this.newPaste();
    const count = this.newPreview().creates.length;
    const ok = await this.confirm.ask({
      title: `Create ${name}?`,
      body: `${name} gets its own roster, comps, games and settings, apart from ${this.data.rootTeamName()}'s; the roster import of ${plural(count, 'player', 'players')} starts at once.`,
      confirmLabel: 'Create team'
    });
    if (!ok) return;
    const again = this.createReason();
    if (again) {
      this.flash(again);
      return;
    }

    this.creating.set(true);
    try {
      const id = newTeamId(name, this.data.teams().map((t) => t.id));
      const team: Team = {
        id,
        name,
        region,
        createdBy: this.auth.userEmail() ?? '',
        createdAt: new Date().toISOString(),
        refresh: 'on'
      };
      await this.data.createTeam(team);
      this.scope.choose(id);
      await this.rememberTeam(id);
      const ready = await this.awaitScope(id);
      if (this.scope.activeTeamId() !== id) {
        // The teams list sent the scope back (the document was not in a server snapshot), or something else chose.
        // Importing now would land the roster on whichever team is active, so nothing is imported.
        this.flash(`Created ${name}, but the app is not on it; open it from the list and paste the roster on Players.`);
        return;
      }
      this.shell.requestResync();
      const reason = await this.importer.run(text);
      // The fold empties only once the paste has been handed over. The team exists either way, so its name and
      // region are spent; a refused run keeps the paste where it is, to be copied to Players rather than found again.
      this.newName.set('');
      this.newRegion.set('euw');
      if (reason) {
        this.flash(`Created ${name}; the import did not start: ${reason} The paste is still in the fold; copy it to Players.`);
        return;
      }
      this.newPaste.set('');
      this.flash(ready ? `Created ${name}; importing ${plural(count, 'player', 'players')}.` : `Created ${name}; importing ${plural(count, 'player', 'players')}, though its data has not loaded here yet.`);
    } catch (error) {
      this.flash(error instanceof Error ? error.message : 'The team could not be created.');
    } finally {
      this.creating.set(false);
    }
  }

  /** The Switch to pill: choose the scope, remember it, and re-seed the drafts once the team's data is in. */
  async switchTo(id: string): Promise<void> {
    const refused = this.switchReason();
    if (refused) {
      this.flash(refused);
      return;
    }
    if (id === this.scope.activeTeamId()) return;
    const row = this.rows().find((r) => r.id === id);
    if (!row) {
      this.flash('That team is not in the list any more.');
      return;
    }
    try {
      this.scope.choose(id);
    } catch (error) {
      // The list holds team ids only, so this is a document made by hand since; said here, not as an unhandled rejection.
      this.flash(error instanceof Error ? error.message : 'That team could not be opened.');
      return;
    }
    await this.rememberTeam(id);
    await this.awaitScope(id);
    this.shell.requestResync();
    this.flash(`Switched to ${row.name}.`);
  }

  /**
   * The delete guard: only an empty team goes. The prefix is checked first and the refusal names the
   * collection that stands in the way, then the question, then the batch, which checks again. The root
   * team has no pill and is refused here as well. Deleting the active team puts the person on the default.
   */
  async deleteTeam(row: TeamRow): Promise<void> {
    if (row.isDefault) return;
    if (!this.auth.canManageUsers()) {
      this.flash('Only admins can delete a team.');
      return;
    }
    const job = this.runningJob();
    if (job) {
      this.flash(`${job} is running; wait for it to finish before deleting a team.`);
      return;
    }
    let holds: string | null;
    try {
      holds = await this.data.teamHasData(row.id);
    } catch (error) {
      this.flash(error instanceof Error ? error.message : 'The team could not be checked.');
      return;
    }
    if (holds) {
      this.flash(`${row.name} still has ${holds}; only an empty team can be deleted. Take that off first.`);
      return;
    }
    const ok = await this.confirm.ask({
      title: `Delete ${row.name}?`,
      body: 'It holds no players, comps or games, so only its document and settings go. Anyone on it is put back on the default team.',
      confirmLabel: 'Delete team',
      danger: true
    });
    if (!ok) return;
    try {
      await this.data.deleteTeam(row.id);
    } catch (error) {
      this.flash(error instanceof Error ? error.message : 'The team could not be deleted.');
      return;
    }
    if (row.active) {
      this.scope.choose(DEFAULT_TEAM_ID);
      await this.rememberTeam(DEFAULT_TEAM_ID);
      await this.awaitScope(DEFAULT_TEAM_ID);
      this.shell.requestResync();
    }
    this.flash(`Deleted ${row.name}.`);
  }

  /** The person's document follows the device's choice; a refused write keeps the device's, and the next switch catches up. */
  private async rememberTeam(id: string): Promise<void> {
    try {
      await this.prefs.setTeam(id);
    } catch {
      // The choice holds on this device; the document is corrected on the next switch.
    }
  }

  /**
   * Wait until the scope is the given team and its data is ready to read (the players snapshot of the team the
   * listeners are open for settles `ready`, so the way back to the default waits for the default's own and never
   * reads the other team's; a team's own settings snapshot settles `scopeReady`), or the bound passes. A poll
   * rather than an effect: it is one call at a create or a switch, and a spec drives it with fake timers.
   */
  private awaitScope(teamId: string, timeoutMs = SCOPE_WAIT_MS): Promise<boolean> {
    const settled = () => this.scope.activeTeamId() === teamId && this.data.scopeReady();
    if (settled()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (settled()) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(tick, SCOPE_POLL_MS);
      };
      setTimeout(tick, SCOPE_POLL_MS);
    });
  }
}
