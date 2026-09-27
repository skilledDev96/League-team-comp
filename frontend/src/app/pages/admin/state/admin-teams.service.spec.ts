import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { parseRiotIds } from '../../../core/riot-id';
import { planRosterImport } from '../../../core/roster-import';
import { DEFAULT_TEAM_ID, isTeamId } from '../../../core/team-scope';
import { Player, Team } from '../../../models/team.models';
import { ActivityJob, ActivityService } from '../../../services/activity.service';
import { AuthService } from '../../../services/auth.service';
import { ConfirmRequest, ConfirmService } from '../../../services/confirm.service';
import { RosterImportPreview, RosterImportService } from '../../../services/roster-import.service';
import { TeamDataService } from '../../../services/team-data.service';
import { TeamScopeService } from '../../../services/team-scope.service';
import { UserPrefsService } from '../../../services/user-prefs.service';
import { AdminShellService } from './admin-shell.service';
import {
  AdminTeamsService,
  SCOPE_WAIT_MS,
  TeamRow,
  createTeamLabel,
  createTeamReason,
  createdLabel,
  switchTeamReason,
  teamRows
} from './admin-teams.service';

/**
 * Admin › Teams (27 Sep 2026, Stage 3): why the two pills are off, and the order a create runs in.
 * Firestore, the scope, the prefs and the importer are faked; each fake writes its name to one log,
 * so the order of operations is asserted as a list and not inferred. The one thing that matters most
 * is that the importer runs only once the scope is the new team.
 */

const LINK = 'https://www.op.gg/multisearch/euw?summoners=Alpha%23EUW,Bravo%23EUW,Charlie%23EUW,Delta%23EUW,Echo%23EUW';

const team = (id: string, name: string, over: Partial<Team> = {}): Team => ({
  id,
  name,
  region: 'euw',
  createdBy: 'lead@example.com',
  createdAt: '2026-09-27T10:00:00.000Z',
  refresh: 'on',
  ...over
});

function preview(text: string, existing: readonly Player[] = []): RosterImportPreview {
  const ids = parseRiotIds(text);
  return { ...planRosterImport({ ids, existing }), ids, dropped: 0 };
}

describe('teamRows', () => {
  it('puts the root team first as the default, named from the public settings, then the teams by name', () => {
    const rows = teamRows('Bom Squad', [team('zulu-aaaaaa', 'Zulu'), team('alpha-aaaaaa', 'Alpha')], DEFAULT_TEAM_ID);
    expect(rows.map((r) => r.name)).toEqual(['Bom Squad', 'Alpha', 'Zulu']);
    expect(rows[0]).toMatchObject({ id: DEFAULT_TEAM_ID, isDefault: true, active: true, region: null, createdAt: null });
    expect(rows[1]).toMatchObject({ id: 'alpha-aaaaaa', isDefault: false, active: false, region: 'euw' });
  });

  it('marks the active team and not the root when another team is chosen', () => {
    const rows = teamRows('Bom Squad', [team('alpha-aaaaaa', 'Alpha')], 'alpha-aaaaaa');
    expect(rows.map((r) => r.active)).toEqual([false, true]);
  });
});

describe('createTeamLabel', () => {
  it('counts what the pill would import, and stays generic with nothing to count', () => {
    expect(createTeamLabel(preview(''))).toBe('Create team and import players');
    expect(createTeamLabel(preview('Alpha#EUW'))).toBe('Create team and import 1 player');
    expect(createTeamLabel(preview(LINK))).toBe('Create team and import 5 players');
  });
});

describe('createTeamReason', () => {
  const ok = {
    mode: 'firebase' as const,
    admin: true,
    creating: false,
    name: 'Bom Squad Academy',
    taken: ['Bom Squad'],
    paste: LINK,
    preview: preview(LINK),
    runningJob: null,
    importBlocker: null
  };

  it('is null when a team can be created', () => {
    expect(createTeamReason(ok)).toBeNull();
  });

  it('names Firebase in local mode before anything else', () => {
    expect(createTeamReason({ ...ok, mode: 'local', name: '' })).toBe('Teams need Firebase; the local preview has one team.');
  });

  it('is for admins', () => {
    expect(createTeamReason({ ...ok, admin: false })).toBe('Only an admin can create a team.');
  });

  it('waits for a create in flight', () => {
    expect(createTeamReason({ ...ok, creating: true })).toBe('A team is being created; wait for it.');
  });

  it('asks for a name, one with a letter or digit, and one not already taken, the root name included', () => {
    expect(createTeamReason({ ...ok, name: '   ' })).toBe('Give the team a name.');
    expect(createTeamReason({ ...ok, name: '日本語' })).toBe('The name needs at least one letter or digit.');
    expect(createTeamReason({ ...ok, name: ' bom squad ' })).toBe('A team called bom squad already exists.');
  });

  it('asks for the paste, then relays the planner', () => {
    expect(createTeamReason({ ...ok, paste: '', preview: preview('') })).toBe('Paste their op.gg link or Riot IDs first.');
    // A name with no tag is nothing the parser reads, and the planner says so in its own words.
    expect(createTeamReason({ ...ok, paste: 'Alpha', preview: preview('Alpha') })).toBe('No Riot ID could be read. Paste an op.gg multi-link, or one Name#TAG a line.');
    const eleven = Array.from({ length: 11 }, (_, i) => `P${i}#EUW`).join('\n');
    expect(createTeamReason({ ...ok, paste: eleven, preview: preview(eleven) })).toMatch(/at most 10/);
  });

  it('names the job on the Activity board, then the importer\'s own blocker', () => {
    expect(createTeamReason({ ...ok, runningJob: 'Scouting Bom Squad' })).toBe('Scouting Bom Squad is running; wait for it to finish, the import spends the same Riot calls.');
    expect(createTeamReason({ ...ok, importBlocker: 'Only an editor can import a roster.' })).toBe('Only an editor can import a roster.');
  });
});

describe('switchTeamReason', () => {
  it('is null with nothing on the board and names the job otherwise', () => {
    expect(switchTeamReason(null)).toBeNull();
    expect(switchTeamReason('Importing roster')).toBe('Importing roster is running; switching teams would leave it writing to the wrong one. Wait for it to finish.');
  });
});

describe('createdLabel', () => {
  it('reads the day, month and year, and gives back a stamp it cannot read', () => {
    const label = createdLabel('2026-09-27T10:00:00.000Z');
    expect(label).toMatch(/27/);
    expect(label).toMatch(/2026/);
    expect(createdLabel('yesterday')).toBe('yesterday');
  });
});

describe('AdminTeamsService', () => {
  let svc: AdminTeamsService;
  let shell: AdminShellService;
  let log: string[];
  let teams: WritableSignal<Team[]>;
  let scopeReady: WritableSignal<boolean>;
  let activeTeamId: WritableSignal<string>;
  let primary: WritableSignal<ActivityJob | null>;
  let mode: 'firebase' | 'local';
  let ask: Mock<(request: ConfirmRequest) => Promise<boolean>>;
  let createTeam: Mock<(team: Team) => Promise<void>>;
  let teamHasData: Mock<(id: string) => Promise<string | null>>;
  let deleteTeam: Mock<(id: string) => Promise<void>>;
  let choose: Mock<(id: string) => void>;
  let setTeam: Mock<(id: string) => Promise<void>>;
  let run: Mock<(text: string) => Promise<string | null>>;
  /** The scope the importer saw when it was handed the paste. */
  let ranOn: string | null;

  function create(): void {
    log = [];
    ranOn = null;
    teams = signal<Team[]>([]);
    scopeReady = signal(true);
    activeTeamId = signal(DEFAULT_TEAM_ID);
    primary = signal<ActivityJob | null>(null);
    ask = vi.fn(async (_request: ConfirmRequest) => {
      log.push('ask');
      return true;
    });
    createTeam = vi.fn(async (t: Team) => {
      log.push(`createTeam:${t.id}`);
      teams.update((list) => [...list, t]);
    });
    teamHasData = vi.fn(async (_id: string) => null);
    deleteTeam = vi.fn(async (id: string) => {
      log.push(`deleteTeam:${id}`);
      teams.update((list) => list.filter((t) => t.id !== id));
    });
    choose = vi.fn((id: string) => {
      log.push(`choose:${id}`);
      activeTeamId.set(id);
    });
    setTeam = vi.fn(async (id: string) => {
      log.push(`setTeam:${id}`);
    });
    run = vi.fn(async (_text: string) => {
      log.push('run');
      ranOn = activeTeamId();
      return null;
    });
    const data = {
      mode,
      teams,
      rootTeamName: signal('Bom Squad'),
      scopeReady,
      ready: signal(true),
      players: signal<Player[]>([]),
      createTeam,
      teamHasData,
      deleteTeam
    };
    const importer = {
      preview: (text: string, existing: readonly Player[]) => preview(text, existing),
      run,
      blocker: signal<string | null>(null),
      importing: signal(false),
      rows: signal([])
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AdminTeamsService,
        AdminShellService,
        { provide: TeamDataService, useValue: data },
        { provide: AuthService, useValue: { mode, canManageUsers: signal(true), canEdit: signal(true), userEmail: signal('lead@example.com') } },
        { provide: TeamScopeService, useValue: { activeTeamId, choose } },
        { provide: UserPrefsService, useValue: { setTeam } },
        { provide: ConfirmService, useValue: { ask } },
        { provide: ActivityService, useValue: { primary, busy: signal(false) } },
        { provide: RosterImportService, useValue: importer }
      ]
    });
    svc = TestBed.inject(AdminTeamsService);
    shell = TestBed.inject(AdminShellService);
  }

  beforeEach(() => {
    mode = 'firebase';
    create();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fill(name = 'Bom Squad Academy', paste = LINK): void {
    svc.newName.set(name);
    svc.newPaste.set(paste);
  }

  describe('the reasons', () => {
    it('lists the root team first and the region choices op.gg knows', () => {
      teams.set([team('alpha-aaaaaa', 'Alpha')]);
      expect(svc.rows().map((r) => r.name)).toEqual(['Bom Squad', 'Alpha']);
      expect(svc.regions.map((r) => r.code)).toEqual(['euw', 'eune', 'na', 'kr', 'br', 'jp', 'lan', 'las', 'oce', 'ru', 'tr']);
      expect(svc.regions[0].label).toBe('EUW');
    });

    it('is off with no name, off with nothing readable, and on with both', () => {
      expect(svc.createReason()).toBe('Give the team a name.');
      svc.newName.set('Bom Squad Academy');
      expect(svc.createReason()).toBe('Paste their op.gg link or Riot IDs first.');
      svc.newPaste.set('nothing here');
      expect(svc.createReason()).toBe('No Riot ID could be read. Paste an op.gg multi-link, or one Name#TAG a line.');
      svc.newPaste.set(LINK);
      expect(svc.createReason()).toBeNull();
      expect(svc.createLabel()).toBe('Create team and import 5 players');
      expect(svc.newLine()).toMatch(/^5 players read: Alpha#EUW to Top/);
    });

    it('plans the paste against an empty roster, not the active team\'s players', () => {
      // The fake data holds no players, so the proof is the preview's existing list: five creates, no skips.
      fill();
      expect(svc.newPreview().creates).toHaveLength(5);
      expect(svc.newPreview().skips).toHaveLength(0);
    });

    it('names the job on the board for both pills while one runs', () => {
      fill();
      primary.set({ id: 1, label: 'Refreshing player data', detail: '', startedAt: 0 });
      expect(svc.createReason()).toMatch(/^Refreshing player data is running/);
      expect(svc.switchReason()).toMatch(/^Refreshing player data is running/);
      primary.set(null);
      expect(svc.switchReason()).toBeNull();
    });

    it('says teams need Firebase in local mode', () => {
      mode = 'local';
      create();
      fill();
      expect(svc.createReason()).toBe('Teams need Firebase; the local preview has one team.');
    });
  });

  describe('createTeam', () => {
    it('asks, writes the batch, switches the scope, remembers it, and only then runs the importer', async () => {
      fill();
      await svc.createTeam();
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask.mock.calls[0][0]).toMatchObject({ title: 'Create Bom Squad Academy?', confirmLabel: 'Create team' });
      expect(ask.mock.calls[0][0].body).toMatch(/its own roster, comps, games and settings/);
      const id = createTeam.mock.calls[0][0].id;
      expect(id).toMatch(/^bom-squad-academy-[a-z0-9]{6}$/);
      expect(isTeamId(id)).toBe(true);
      expect(log).toEqual(['ask', `createTeam:${id}`, `choose:${id}`, `setTeam:${id}`, 'run']);
      expect(ranOn).toBe(id);
      expect(run).toHaveBeenCalledWith(LINK);
      expect(createTeam.mock.calls[0][0]).toMatchObject({ name: 'Bom Squad Academy', region: 'euw', createdBy: 'lead@example.com', refresh: 'on' });
      expect(createTeam.mock.calls[0][0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(svc.newName()).toBe('');
      expect(svc.newPaste()).toBe('');
      expect(shell.resyncToken()).toBe(1);
      expect(shell.status()).toBe('Created Bom Squad Academy; importing 5 players.');
      expect(svc.creating()).toBe(false);
    });

    it('takes the region from the select and never collides with a team already listed', async () => {
      teams.set([team('bom-squad-academy-aaaaaa', 'Old Academy')]);
      fill();
      svc.newRegion.set('na');
      await svc.createTeam();
      const written = createTeam.mock.calls[0][0];
      expect(written.region).toBe('na');
      expect(written.id).not.toBe('bom-squad-academy-aaaaaa');
    });

    it('writes nothing when the question is cancelled, and keeps the form', async () => {
      ask.mockImplementationOnce(async () => {
        log.push('ask');
        return false;
      });
      fill();
      await svc.createTeam();
      expect(log).toEqual(['ask']);
      expect(createTeam).not.toHaveBeenCalled();
      expect(svc.newName()).toBe('Bom Squad Academy');
      expect(svc.newPaste()).toBe(LINK);
    });

    it('refuses on the status line, without asking, while the pill has a reason', async () => {
      fill('Bom Squad');
      await svc.createTeam();
      expect(ask).not.toHaveBeenCalled();
      expect(shell.status()).toBe('A team called Bom Squad already exists.');
    });

    it('checks again after the question: a job that started while it was open stops the create', async () => {
      fill();
      ask.mockImplementationOnce(async () => {
        log.push('ask');
        primary.set({ id: 1, label: 'Scouting Bom Squad', detail: '', startedAt: 0 });
        return true;
      });
      await svc.createTeam();
      expect(log).toEqual(['ask']);
      expect(shell.status()).toMatch(/^Scouting Bom Squad is running/);
    });

    it('stops at a failed batch: no scope switch, no import, and the reason on the status line', async () => {
      createTeam.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
      fill();
      await svc.createTeam();
      // The rejected call did not reach the fake's body, so the batch never logs; nothing after it runs.
      expect(log).toEqual(['ask']);
      expect(choose).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(shell.status()).toBe('Missing or insufficient permissions.');
      expect(svc.creating()).toBe(false);
      expect(svc.newName()).toBe('Bom Squad Academy');
    });

    it('waits for the new scope to be ready before importing, and goes on after the bound when it never is', async () => {
      vi.useFakeTimers();
      scopeReady.set(false);
      fill();
      const done = svc.createTeam();
      await vi.advanceTimersByTimeAsync(SCOPE_WAIT_MS / 2);
      expect(run).not.toHaveBeenCalled();
      scopeReady.set(true);
      await vi.advanceTimersByTimeAsync(200);
      await done;
      expect(run).toHaveBeenCalledTimes(1);
      expect(shell.status()).toBe('Created Bom Squad Academy; importing 5 players.');

      // The bound: the players snapshot never arrives (a refused listen). The scope is still the new team, so the
      // import runs, and the line says the page has not caught up.
      create();
      vi.useFakeTimers();
      scopeReady.set(false);
      fill();
      const late = svc.createTeam();
      await vi.advanceTimersByTimeAsync(SCOPE_WAIT_MS + 200);
      await late;
      expect(run).toHaveBeenCalledTimes(1);
      expect(shell.status()).toMatch(/though its data has not loaded here yet/);
    });

    it('never imports onto another team: when the scope is not the new team after the wait, nothing runs', async () => {
      vi.useFakeTimers();
      setTeam.mockImplementationOnce(async (id: string) => {
        log.push(`setTeam:${id}`);
        // The teams list's fallback sent the scope back before the wait began.
        activeTeamId.set(DEFAULT_TEAM_ID);
      });
      fill();
      const done = svc.createTeam();
      await vi.advanceTimersByTimeAsync(SCOPE_WAIT_MS + 200);
      await done;
      expect(run).not.toHaveBeenCalled();
      expect(shell.status()).toMatch(/but the app is not on it/);
      expect(svc.newPaste()).toBe(LINK);
    });

    it('empties the fold the moment the team exists, before the importer is handed the paste', async () => {
      let foldAtRun: { name: string; paste: string } | null = null;
      run.mockImplementationOnce(async () => {
        log.push('run');
        foldAtRun = { name: svc.newName(), paste: svc.newPaste() };
        return null;
      });
      fill();
      await svc.createTeam();
      expect(foldAtRun).toEqual({ name: '', paste: '' });
      expect(svc.newPaste()).toBe('');
      expect(shell.status()).toBe('Created Bom Squad Academy; importing 5 players.');
    });

    it('keeps the paste in the fold when the importer refuses after the team exists, and says so', async () => {
      run.mockImplementationOnce(async () => {
        log.push('run');
        return 'Wait for the scout to finish; it spends the same Riot calls.';
      });
      fill();
      await svc.createTeam();
      const id = createTeam.mock.calls[0][0].id;
      expect(log).toEqual(['ask', `createTeam:${id}`, `choose:${id}`, `setTeam:${id}`, 'run']);
      expect(shell.status()).toBe(
        'Created Bom Squad Academy; the import did not start: Wait for the scout to finish; it spends the same Riot calls. The paste is still in the fold; copy it to Players.'
      );
      // The team exists, so its name is spent; the paste is not.
      expect(svc.newName()).toBe('');
      expect(svc.newPaste()).toBe(LINK);
      expect(svc.creating()).toBe(false);
    });
  });

  describe('switchTo', () => {
    it('chooses the scope, remembers it and re-seeds the drafts', async () => {
      teams.set([team('alpha-aaaaaa', 'Alpha')]);
      await svc.switchTo('alpha-aaaaaa');
      expect(log).toEqual(['choose:alpha-aaaaaa', 'setTeam:alpha-aaaaaa']);
      expect(shell.resyncToken()).toBe(1);
      expect(shell.status()).toBe('Switched to Alpha.');
    });

    it('does nothing for the team already active, and refuses while a job runs', async () => {
      await svc.switchTo(DEFAULT_TEAM_ID);
      expect(log).toEqual([]);
      teams.set([team('alpha-aaaaaa', 'Alpha')]);
      primary.set({ id: 1, label: 'Importing roster', detail: '', startedAt: 0 });
      await svc.switchTo('alpha-aaaaaa');
      expect(choose).not.toHaveBeenCalled();
      expect(shell.status()).toMatch(/^Importing roster is running/);
    });

    it("waits, on the way back to the default, for the default's own data before it re-seeds and says so", async () => {
      // The moment the scope moves, the data service's ready is still the other team's true (its listeners close in
      // an effect, a tick later), so the wait must not be satisfied by it: the fake holds scopeReady false until the
      // default's own snapshot, as the service does since 27 Sep 2026.
      vi.useFakeTimers();
      teams.set([team('alpha-aaaaaa', 'Alpha')]);
      activeTeamId.set('alpha-aaaaaa');
      scopeReady.set(false);
      const done = svc.switchTo(DEFAULT_TEAM_ID);
      await vi.advanceTimersByTimeAsync(SCOPE_WAIT_MS / 2);
      expect(log).toEqual([`choose:${DEFAULT_TEAM_ID}`, `setTeam:${DEFAULT_TEAM_ID}`]);
      expect(shell.resyncToken()).toBe(0);
      expect(shell.status()).toBe('');
      scopeReady.set(true);
      await vi.advanceTimersByTimeAsync(200);
      await done;
      expect(shell.resyncToken()).toBe(1);
      expect(shell.status()).toBe('Switched to Bom Squad.');
    });

    it('says on the status line when the scope refuses the id, and remembers nothing', async () => {
      teams.set([team('alpha-aaaaaa', 'Alpha')]);
      choose.mockImplementationOnce(() => {
        throw new Error('Not a team id: "alpha-aaaaaa"');
      });
      await svc.switchTo('alpha-aaaaaa');
      expect(setTeam).not.toHaveBeenCalled();
      expect(shell.resyncToken()).toBe(0);
      expect(shell.status()).toBe('Not a team id: "alpha-aaaaaa"');
    });
  });

  describe('deleteTeam', () => {
    const row = (over: Partial<TeamRow> = {}): TeamRow => ({
      id: 'alpha-aaaaaa',
      name: 'Alpha',
      region: 'euw',
      createdBy: 'lead@example.com',
      createdAt: '2026-09-27T10:00:00.000Z',
      isDefault: false,
      active: false,
      ...over
    });

    it('refuses, naming the collection, while the prefix holds a document, and never asks', async () => {
      teamHasData.mockResolvedValueOnce('players');
      await svc.deleteTeam(row());
      expect(ask).not.toHaveBeenCalled();
      expect(deleteTeam).not.toHaveBeenCalled();
      expect(shell.status()).toBe('Alpha still has players; only an empty team can be deleted. Take that off first.');
    });

    it('asks with the danger button and deletes an empty team', async () => {
      teams.set([team('alpha-aaaaaa', 'Alpha')]);
      await svc.deleteTeam(row());
      expect(ask.mock.calls[0][0]).toMatchObject({ title: 'Delete Alpha?', confirmLabel: 'Delete team', danger: true });
      expect(log).toEqual(['ask', 'deleteTeam:alpha-aaaaaa']);
      expect(choose).not.toHaveBeenCalled();
      expect(shell.status()).toBe('Deleted Alpha.');
    });

    it('puts the person back on the default when the active team goes', async () => {
      teams.set([team('alpha-aaaaaa', 'Alpha')]);
      activeTeamId.set('alpha-aaaaaa');
      await svc.deleteTeam(row({ active: true }));
      expect(log).toEqual(['ask', 'deleteTeam:alpha-aaaaaa', `choose:${DEFAULT_TEAM_ID}`, `setTeam:${DEFAULT_TEAM_ID}`]);
      expect(shell.resyncToken()).toBe(1);
    });

    it('never deletes the root team, and waits for a running job', async () => {
      await svc.deleteTeam(row({ id: DEFAULT_TEAM_ID, name: 'Bom Squad', isDefault: true, active: true }));
      expect(teamHasData).not.toHaveBeenCalled();
      primary.set({ id: 1, label: 'Importing roster', detail: '', startedAt: 0 });
      await svc.deleteTeam(row());
      expect(teamHasData).not.toHaveBeenCalled();
      expect(shell.status()).toMatch(/^Importing roster is running/);
    });
  });
});
