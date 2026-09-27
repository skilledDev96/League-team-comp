import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { Player, Role } from '../models/team.models';
import { ActivityService } from './activity.service';
import { AuthService } from './auth.service';
import { ConfirmRequest, ConfirmService } from './confirm.service';
import { OpponentScoutService } from './opponent-scout.service';
import { EnrichResponse, mergeChampionPool, PlayerEnrichmentService } from './player-enrichment.service';
import { RefreshService } from './refresh.service';
import { RosterImportService, unreadEntries } from './roster-import.service';
import { TeamDataService } from './team-data.service';
import { ToastService } from './toast.service';

// Local mode, as team-data.service.spec.ts runs: isFirebaseConfigured() reads the
// apiKey, so blanking it keeps TeamDataService on localStorage and AuthService
// off Firebase. Whether Riot can be asked is the one thing the service decides
// from that flag, and it sits behind a protected method so a spec can say yes.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const LINK = 'https://www.op.gg/multisearch/euw?summoners=Alpha%23EUW,Bravo%23123,Charlie%23EUW,Delta%23EUW,Echo%23EUW';
const SIX = `${LINK},Foxtrot%23EUW`;

type EnrichRequest = { summonerName: string; riotTag?: string; region?: string; role?: Role; mobalyticsSlug?: string };
type Enrich = (request: EnrichRequest) => Promise<EnrichResponse>;
type Proto = { riotReachable(): boolean };

const provider = (over: Partial<EnrichResponse> = {}): EnrichResponse => ({
  playstyle: 'Tempo jungler',
  strengths: ['Pathing'],
  weaknesses: ['Vision'],
  top3: ['Lee Sin'],
  bans: ['Nidalee'],
  iconUrl: 'https://cdn/icon.png',
  source: 'provider',
  provider: 'riot',
  generatedAt: '2026-09-27T10:00:00Z',
  ...over
});

/** What enrichPlayer answers on any failure: a role template, the reason in `provider`. */
const template = (reason: string): EnrichResponse => ({
  playstyle: 'Lane-priority bruiser with side-lane threat and TP timing focus.',
  strengths: ['Strong wave control'],
  weaknesses: ['Can overextend in side lane'],
  source: 'template',
  provider: `template-fallback: ${reason}`,
  generatedAt: '2026-09-27T10:00:00Z'
});

const UNKNOWN_ID = 'Riot API request failed (404) on account-v1.';
const NO_GAMES = 'No recent ranked/normal match history found for this Riot ID.';

const handMade = (name: string, role: Role, over: Partial<Player> = {}): Player => ({
  id: `hand-${name.toLowerCase()}`,
  name,
  role,
  strengths: ['Knows the map'],
  weaknesses: [],
  top3: ['Ornn'],
  bans: [],
  curated: true,
  order: 0,
  ...over
});

describe('RosterImportService', () => {
  let svc: RosterImportService;
  let data: TeamDataService;
  let activity: ActivityService;
  let toast: ToastService;
  let auth: AuthService;
  let enrichPlayer: Mock<Enrich>;
  let ask: Mock<(request: ConfirmRequest) => Promise<boolean>>;

  function create(reachable = true): void {
    localStorage.clear();
    TestBed.resetTestingModule();
    vi.spyOn(RosterImportService.prototype as unknown as Proto, 'riotReachable').mockReturnValue(reachable);
    enrichPlayer = vi.fn<Enrich>(async ({ role }) => provider({ role }));
    ask = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        { provide: PlayerEnrichmentService, useValue: { enrichPlayer, mergeChampionPool } },
        { provide: ConfirmService, useValue: { ask } }
      ]
    });
    data = TestBed.inject(TeamDataService);
    // The local seed carries Bom Squad's five; an import is for a roster that is empty or short.
    data.players.set([]);
    activity = TestBed.inject(ActivityService);
    toast = TestBed.inject(ToastService);
    auth = TestBed.inject(AuthService);
    svc = TestBed.inject(RosterImportService);
    TestBed.tick();
  }

  const names = () => data.players().map((p) => p.name);
  const states = () => svc.rows().map((r) => r.state);
  const undoToast = () => toast.toasts().find((t) => t.action?.label === 'Undo');

  beforeEach(() => create());

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('creates five players in seat order, reads each from Riot in turn and writes what came back', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => provider({ role, playstyle: `${summonerName} plays fast` }));
    expect(await svc.run(LINK)).toBeNull();

    expect(data.players().map((p) => [p.name, p.role, p.sub])).toEqual([
      ['Alpha', 'Top', undefined],
      ['Bravo', 'Jungle', undefined],
      ['Charlie', 'Mid', undefined],
      ['Delta', 'ADC', undefined],
      ['Echo', 'Support', undefined]
    ]);
    expect(svc.createdIds()).toEqual(data.players().map((p) => p.id));
    expect(states()).toEqual(['done', 'done', 'done', 'done', 'done']);
    // The same body the roster refresh sends, one player at a time, in paste order.
    expect(enrichPlayer.mock.calls.map(([r]) => [r.summonerName, r.riotTag, r.region, r.role])).toEqual([
      ['Alpha', 'EUW', 'euw', 'Top'],
      ['Bravo', '123', 'euw', 'Jungle'],
      ['Charlie', 'EUW', 'euw', 'Mid'],
      ['Delta', 'EUW', 'euw', 'ADC'],
      ['Echo', 'EUW', 'euw', 'Support']
    ]);
    const bravo = data.players()[1];
    expect(bravo).toMatchObject({ playstyle: 'Bravo plays fast', strengths: ['Pathing'], top3: ['Lee Sin'], bans: ['Nidalee'], icon: 'https://cdn/icon.png' });
    expect(bravo.refreshedAt).toBeTruthy();
    expect(bravo.curated).toBeUndefined();
    // An empty roster asks no question; the finish toast offers Undo.
    expect(ask).not.toHaveBeenCalled();
    expect(undoToast()?.title).toBe('Imported 5 players');
    expect(svc.importing()).toBe(false);
    expect(activity.jobs()).toEqual([]);
  });

  it('shows progress and the job while it reads: the line, the estimate and the board', async () => {
    let seen: { progress: string; secondsLeft: number; importing: boolean; onBoard: boolean } | undefined;
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => {
      if (summonerName === 'Charlie') {
        seen = { progress: svc.progress(), secondsLeft: svc.secondsLeft(), importing: svc.importing(), onBoard: activity.has('Importing roster') };
      }
      return provider({ role });
    });
    await svc.run(LINK);
    expect(seen).toEqual({ progress: 'Reading Charlie#EUW (3 of 5) from Riot…', secondsLeft: 180, importing: true, onBoard: true });
    expect(svc.progress()).toBe('');
    expect(svc.total()).toBe(0);
  });

  it('keeps a starter in the pasted seat when Riot sees them elsewhere and notes the suggestion; a sub takes Riot\'s seat', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) =>
      provider({ role: summonerName === 'Alpha' ? 'Jungle' : summonerName === 'Foxtrot' ? 'Mid' : role })
    );
    await svc.run(SIX);
    const alpha = data.players().find((p) => p.name === 'Alpha')!;
    const foxtrot = data.players().find((p) => p.name === 'Foxtrot')!;
    expect(alpha.role).toBe('Top');
    expect(svc.rows()[0]).toMatchObject({ state: 'done', seat: 'Top', sub: false, suggestion: 'Jungle' });
    expect(foxtrot).toMatchObject({ role: 'Mid', sub: true });
    expect(svc.rows()[5]).toMatchObject({ state: 'done', seat: 'Mid', sub: true });
    expect(svc.rows()[5].suggestion).toBeUndefined();
    expect(svc.rows()[1].suggestion).toBeUndefined();
  });

  it('withdraws its own skeleton when Riot does not know the ID, and says so on the row', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => (summonerName === 'Bravo' ? template(UNKNOWN_ID) : provider({ role })));
    await svc.run(LINK);
    expect(names()).toEqual(['Alpha', 'Charlie', 'Delta', 'Echo']);
    expect(svc.rows()[1]).toMatchObject({ state: 'withdrawn', kind: 'unknown-id', reason: "Riot doesn't know Bravo#123. Check the tag and paste them again." });
    // No player behind the row any more, so no Open pill either (it is gated on playerId).
    expect(svc.rows()[1].playerId).toBeUndefined();
    expect(undoToast()).toMatchObject({ title: 'Imported 4 players', kind: 'warn', text: '1 Riot ID Riot does not know, taken off again.' });
    // Undo takes the withdrawn row with the rest: nothing of the run is left on the card.
    undoToast()!.action!.run();
    await vi.waitFor(() => expect(names()).toEqual([]));
    expect(svc.rows()).toEqual([]);
  });

  it('re-reads the live player before writing, so an edit that landed during the read is kept', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => {
      // A teammate renames them while Riot is being read: the listener lands the new document.
      if (summonerName === 'Charlie') data.players.update((list) => list.map((p) => (p.name === 'Charlie' ? { ...p, name: 'Charles' } : p)));
      return provider({ role });
    });
    await svc.run(LINK);
    const charles = data.players()[2];
    expect(charles).toMatchObject({ name: 'Charles', role: 'Mid', strengths: ['Pathing'], top3: ['Lee Sin'] });
    expect(charles.refreshedAt).toBeTruthy();
    expect(names()).not.toContain('Charlie');
    expect(svc.rows()[2].state).toBe('done');
  });

  it("keeps a hand edit made while Riot was being read: the editor's seat and text stay, the stats and the stamp land", async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => {
      if (summonerName === 'Foxtrot') {
        // The editor opens the sub's panel during the read and seats them at Support; the autosave stamps curated.
        const foxtrot = data.players().find((p) => p.name === 'Foxtrot')!;
        await data.updatePlayer({ ...foxtrot, role: 'Support', strengths: ['Shotcalls'], curated: true });
        return provider({ role: 'Jungle', queueStats: { solo: {} } });
      }
      return provider({ role });
    });
    await svc.run(SIX);
    const foxtrot = data.players().find((p) => p.name === 'Foxtrot')!;
    expect(foxtrot).toMatchObject({ role: 'Support', sub: true, strengths: ['Shotcalls'], curated: true, queueStats: { solo: {} } });
    expect(foxtrot.playstyle).toBeUndefined();
    expect(foxtrot.refreshedAt).toBeTruthy();
    // The row shows the editor's seat, and Riot's as the suggestion it is.
    expect(svc.rows()[5]).toMatchObject({ state: 'done', seat: 'Support', sub: true, suggestion: 'Jungle' });
  });

  it('keeps the skeleton with the reason when Riot has no games for them, and never writes the template text', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => (summonerName === 'Charlie' ? template(NO_GAMES) : provider({ role })));
    await svc.run(LINK);
    const charlie = data.players().find((p) => p.name === 'Charlie')!;
    expect(charlie).toMatchObject({ role: 'Mid', strengths: [], weaknesses: [], top3: [], bans: [] });
    expect(charlie.playstyle).toBeUndefined();
    expect(charlie.refreshedAt).toBeUndefined();
    expect(svc.rows()[2]).toMatchObject({ state: 'failed', kind: 'no-games', reason: 'No recent ranked or normal games to read yet.' });
    expect(undoToast()?.text).toBe('1 player could not be read from Riot; Retry is on the row.');
  });

  it('fails one row on a thrown read and carries on with the rest', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => {
      if (summonerName === 'Delta') throw new Error('Riot timed out after 300 s');
      return provider({ role });
    });
    await svc.run(LINK);
    expect(states()).toEqual(['done', 'done', 'done', 'failed', 'done']);
    expect(svc.rows()[3]).toMatchObject({ kind: 'other', reason: 'Riot timed out after 300 s' });
    expect(names()).toHaveLength(5);
    expect(enrichPlayer).toHaveBeenCalledTimes(5);
  });

  it('fails every waiting row when a skeleton write throws, and Retry writes the missing one in the seat the row shows', async () => {
    const real = data.createPlayer.bind(data);
    let writes = 0;
    const createPlayer = vi.spyOn(data, 'createPlayer').mockImplementation(async (p) => {
      writes += 1;
      if (writes === 3) throw new Error('Missing or insufficient permissions.');
      return real(p);
    });
    await svc.run(LINK);
    expect(names()).toEqual(['Alpha', 'Bravo']);
    // Nobody is left "Waiting": the two written were never read, the three unwritten were never added.
    expect(states()).toEqual(['failed', 'failed', 'failed', 'failed', 'failed']);
    expect(svc.rows()[0].reason).toMatch(/^Not read/);
    expect(svc.rows()[2].reason).toBe('Not added: Missing or insufficient permissions.');
    expect(enrichPlayer).not.toHaveBeenCalled();
    expect(undoToast()).toMatchObject({
      title: 'Imported 2 players',
      text: '3 players were not added; Retry is on the row. 2 players could not be read from Riot; Retry is on the row.'
    });

    createPlayer.mockImplementation(real);
    // Retry on a written row reads it.
    expect(await svc.retry(svc.rows()[0])).toBeNull();
    expect(enrichPlayer).toHaveBeenCalledTimes(1);
    expect(svc.rows()[0].state).toBe('done');
    // Retry on an unwritten row writes it where the row says, not at Top and not on the bench.
    expect(await svc.retry(svc.rows()[2])).toBeNull();
    const charlie = data.players().find((p) => p.name === 'Charlie')!;
    expect(charlie.role).toBe('Mid');
    expect(charlie.sub).toBeUndefined();
    expect(svc.rows()[2]).toMatchObject({ state: 'done', seat: 'Mid', sub: false });
    expect(svc.createdIds()).toContain(charlie.id);
  });

  it('holds the scout and the refresh pills off while it runs: anyRunning is true and Scout us does nothing', async () => {
    const refresh = TestBed.inject(RefreshService);
    const scout = TestBed.inject(OpponentScoutService);
    const saveSelfScout = vi.spyOn(data, 'saveSelfScout');
    let seen: { anyRunning: boolean; scouting: string | null } | undefined;
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => {
      if (summonerName === 'Charlie') {
        await scout.scoutOurselves(data.players(), 'Bom Squad');
        seen = { anyRunning: refresh.anyRunning(), scouting: scout.scouting() };
      }
      return provider({ role });
    });
    await svc.run(LINK);
    expect(seen).toEqual({ anyRunning: true, scouting: null });
    expect(saveSelfScout).not.toHaveBeenCalled();
    expect(enrichPlayer).toHaveBeenCalledTimes(5);
    expect(refresh.anyRunning()).toBe(false);
  });

  it('refuses while a scout, a player refresh or another import is on the board, and names the job', async () => {
    const scout = activity.begin('Scouting Paradox Requiem');
    expect(svc.canStart()).toBe(false);
    expect(await svc.run(LINK)).toMatch(/scout/);
    scout.end();

    const refresh = activity.begin('Refreshing player data');
    expect(await svc.run(LINK)).toMatch(/player refresh/);
    refresh.end();

    const other = activity.begin('Importing roster');
    expect(await svc.run(LINK)).toMatch(/import is already running/);
    other.end();

    expect(names()).toEqual([]);
    expect(enrichPlayer).not.toHaveBeenCalled();
    expect(svc.canStart()).toBe(true);
  });

  it('asks before adding to a roster that has players, names the button for the count, and does nothing on Cancel', async () => {
    data.players.set([handMade('Rulukuku', 'Top', { profile: { region: 'euw', riotTag: 'EUW' } })]);
    ask.mockResolvedValue(false);
    expect(await svc.run(`${LINK},Rulukuku%23EUW`)).toBeNull();
    expect(ask).toHaveBeenCalledWith({
      title: 'Add 5 players to the roster?',
      body: '1 player is already here; 1 in the paste is already on it and will be skipped.',
      confirmLabel: 'Add 5 players'
    });
    expect(names()).toEqual(['Rulukuku']);
    expect(svc.rows()).toEqual([]);

    ask.mockResolvedValue(true);
    await svc.run(`${LINK},Rulukuku%23EUW`);
    expect(names()).toEqual(['Rulukuku', 'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    // Rulukuku holds Top, so Alpha is a sub; the skipped row shows Rulukuku's own seat.
    expect(svc.rows()[0]).toMatchObject({ state: 'done', seat: 'Top', sub: true });
    expect(svc.rows()[5]).toMatchObject({ state: 'skipped', seat: 'Top', reason: 'Already on the roster.' });
    expect(svc.rows()[5].playerId).toBeUndefined();
  });

  it('Undo takes off only the players the import made, and says how many', async () => {
    data.players.set([handMade('Rulukuku', 'Top')]);
    await svc.run(LINK);
    expect(names()).toHaveLength(6);
    // A player added by hand after the run is not the import's either.
    await data.createPlayer({ name: 'Newcomer', role: 'Mid', strengths: [], weaknesses: [], top3: [], bans: [] });

    undoToast()!.action!.run();
    await vi.waitFor(() => expect(names()).toEqual(['Rulukuku', 'Newcomer']));
    expect(toast.toasts().some((t) => t.title === 'Removed 5 players')).toBe(true);
    expect(svc.createdIds()).toEqual([]);
    expect(svc.rows()).toEqual([]);
  });

  it('creates nothing when the same paste is run again', async () => {
    await svc.run(LINK);
    expect(await svc.run(LINK)).toBe('All 5 are already on the roster; nothing to add.');
    expect(names()).toHaveLength(5);
    expect(enrichPlayer).toHaveBeenCalledTimes(5);
    expect(ask).not.toHaveBeenCalled();
    expect(svc.preview(LINK)).toMatchObject({ creates: [], dropped: 0 });
    expect(svc.preview(LINK).skips).toHaveLength(5);
  });

  it('refuses a paste with nothing readable, and over the cap, with the planner\'s reason', async () => {
    expect(await svc.run('just a name with no tag')).toMatch(/No Riot ID could be read/);
    data.players.set(Array.from({ length: 6 }, (_, i) => handMade(`Old${i}`, 'Top')));
    expect(await svc.run(LINK)).toMatch(/at most 10/);
    expect(ask).not.toHaveBeenCalled();
    expect(names()).toHaveLength(6);
  });

  it('in the local preview writes the skeletons, says why the profiles stay empty, and never asks Riot', async () => {
    create(false);
    await svc.run(LINK);
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
    expect(states()).toEqual(['failed', 'failed', 'failed', 'failed', 'failed']);
    expect(svc.rows().every((r) => r.kind === 'local' && r.reason === 'Local preview has no Riot access; the profile stays empty.')).toBe(true);
    expect(enrichPlayer).not.toHaveBeenCalled();
    expect(undoToast()).toMatchObject({ title: 'Imported 5 players', text: 'Local preview has no Riot access; the profiles stay empty.' });
  });

  it('retry reads one failed row again and leaves the others alone', async () => {
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => (summonerName === 'Charlie' ? template(NO_GAMES) : provider({ role })));
    await svc.run(LINK);
    enrichPlayer.mockClear();
    enrichPlayer.mockImplementation(async ({ role }) => provider({ role, playstyle: 'Back from a break' }));

    expect(await svc.retry(svc.rows()[2])).toBeNull();
    expect(enrichPlayer).toHaveBeenCalledTimes(1);
    expect(enrichPlayer.mock.calls[0][0].summonerName).toBe('Charlie');
    expect(svc.rows()[2]).toMatchObject({ state: 'done', reason: undefined, kind: undefined });
    expect(data.players().find((p) => p.name === 'Charlie')?.playstyle).toBe('Back from a break');
    // A row that is not failed is not read again.
    expect(await svc.retry(svc.rows()[0])).toBeNull();
    expect(enrichPlayer).toHaveBeenCalledTimes(1);
  });

  it('seats the starters by Riot\'s roles only when the five are read into five different seats', async () => {
    // A swap: Riot sees Alpha in the jungle and Bravo on top.
    enrichPlayer.mockImplementation(async ({ summonerName, role }) =>
      provider({ role: summonerName === 'Alpha' ? 'Jungle' : summonerName === 'Bravo' ? 'Top' : role })
    );
    await svc.run(LINK);
    const [alpha, bravo] = data.players();
    expect(svc.riotSeats()).toEqual({ [alpha.id]: 'Jungle', [bravo.id]: 'Top', [data.players()[2].id]: 'Mid', [data.players()[3].id]: 'ADC', [data.players()[4].id]: 'Support' });
    expect(await svc.reseatByRiot()).toBe(2);
    expect(data.players().map((p) => p.role)).toEqual(['Jungle', 'Top', 'Mid', 'ADC', 'Support']);
    expect(data.players().every((p) => p.curated === undefined)).toBe(true);
    expect(svc.rows()[0]).toMatchObject({ seat: 'Jungle', suggestion: undefined });
    expect(svc.riotSeats()).toEqual({ [alpha.id]: 'Jungle', [bravo.id]: 'Top', [data.players()[2].id]: 'Mid', [data.players()[3].id]: 'ADC', [data.players()[4].id]: 'Support' });

    // Two starters Riot sees in the same seat is a question for a person.
    create();
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => provider({ role: summonerName === 'Alpha' ? 'Jungle' : role }));
    await svc.run(LINK);
    expect(svc.riotSeats()).toBeNull();
    expect(await svc.reseatByRiot()).toBe(0);
  });

  it('forgets its rows and created ids when the account signs out', async () => {
    auth.enterLocal();
    TestBed.tick();
    await svc.run(LINK);
    expect(svc.rows()).toHaveLength(5);
    expect(svc.createdIds()).toHaveLength(5);

    await auth.logout();
    TestBed.tick();
    expect(svc.rows()).toEqual([]);
    expect(svc.createdIds()).toEqual([]);
    // The players themselves are the team's now; only the import's memory of them goes.
    expect(names()).toHaveLength(5);
  });

  it('stops reading when the account changes mid-run', async () => {
    auth.enterLocal();
    TestBed.tick();
    enrichPlayer.mockImplementation(async ({ summonerName, role }) => {
      if (summonerName === 'Bravo') await auth.logout();
      return provider({ role });
    });
    await svc.run(LINK);
    expect(enrichPlayer).toHaveBeenCalledTimes(2);
    expect(names()).toHaveLength(5);
    expect(data.players().filter((p) => p.refreshedAt)).toHaveLength(2);
    expect(svc.importing()).toBe(false);
    expect(undoToast()).toBeUndefined();
  });

  it('counts what the parser dropped, for the preview line', () => {
    expect(unreadEntries(LINK, 5)).toBe(0);
    expect(unreadEntries('Alpha#EUW\nno tag here\nBravo#EUW', 2)).toBe(1);
    expect(unreadEntries('Alpha#EUW\nalpha#euw', 1)).toBe(1);
    expect(unreadEntries('', 0)).toBe(0);
    const preview = svc.preview('Alpha#EUW\nno tag here\nBravo#EUW');
    expect(preview.creates.map((c) => c.player.name)).toEqual(['Alpha', 'Bravo']);
    expect(preview.ids).toHaveLength(2);
    expect(preview.dropped).toBe(1);
  });

  it("answers a stray percent sign in words rather than throwing into the dialog's computed", async () => {
    // decodeURIComponent throws a URIError on "Alpha%2"; the preview is read on every keystroke.
    expect(() => svc.preview('Alpha%2')).not.toThrow();
    expect(svc.preview('Alpha%2')).toEqual({
      ids: [],
      creates: [],
      skips: [],
      dropped: 0,
      refused: 'That text could not be read. Paste the op.gg link, or one Name#TAG a line.'
    });
    expect(svc.preview('https://www.op.gg/multisearch/euw?summoners=Alpha%2').refused).toMatch(/could not be read/);
    expect(unreadEntries('https://www.op.gg/multisearch/euw?summoners=Alpha%2,Bravo', 0)).toBe(2);
    expect(await svc.run('100%')).toMatch(/could not be read/);
    expect(names()).toEqual([]);
  });
});
