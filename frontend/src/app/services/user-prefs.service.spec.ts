import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { UserPrefs } from '../models/team.models';
import { AuthService } from './auth.service';
import { TeamScopeService } from './team-scope.service';
import { UserPrefsService } from './user-prefs.service';

/**
 * The depth preference, as pure reads and writes over a `UserPrefs` document (12 Sep 2026).
 *
 * The service itself needs a signed-in account and a Firestore door, so what is worth pinning here
 * is the shape discipline the rest of the app depends on: **an absent key means Starter**, so no
 * stored document changes shape and nothing has to be migrated, and going back to Starter deletes
 * the key rather than storing the default a second way.
 */
const depthOf = (prefs: UserPrefs, surface: 'games' | 'reviews' | 'patterns' | 'prep') =>
  prefs.depth?.[surface] === 'full' ? 'full' : 'starter';

const nextDepth = (prefs: UserPrefs, surface: 'games' | 'reviews' | 'patterns' | 'prep', full: boolean) => {
  const depth = { ...(prefs.depth ?? {}) };
  if (full) depth[surface] = 'full';
  else delete depth[surface];
  return depth;
};

describe('the reading depth', () => {
  it('is Starter for a document that has never heard of it', () => {
    // Every stored userPrefs document predates this field.
    const old: UserPrefs = { toursSeen: { welcome: 1 }, film: { seat: 'Jungle' } };
    for (const s of ['games', 'reviews', 'patterns', 'prep'] as const) expect(depthOf(old, s)).toBe('starter');
  });

  it('remembers each surface on its own', () => {
    const prefs: UserPrefs = { depth: nextDepth({}, 'games', true) };
    expect(depthOf(prefs, 'games')).toBe('full');
    expect(depthOf(prefs, 'patterns')).toBe('starter');
  });

  it('deletes the key on the way back rather than storing the default twice', () => {
    const onPrep: UserPrefs = { depth: nextDepth({}, 'prep', true) };
    expect(nextDepth(onPrep, 'prep', false)).toEqual({});

    // And turning one surface back off leaves the others where they were.
    const onBoth: UserPrefs = { depth: nextDepth(onPrep, 'games', true) };
    const prepOff: UserPrefs = { depth: nextDepth(onBoth, 'prep', false) };
    expect(depthOf(prepOff, 'games')).toBe('full');
    expect(depthOf(prepOff, 'prep')).toBe('starter');
  });

  it('leaves everything else in the document untouched', () => {
    const prefs: UserPrefs = { tourSeen: true, toursSeen: { games: 2 }, film: { seat: 'ADC' } };
    const next: UserPrefs = { ...prefs, depth: nextDepth(prefs, 'reviews', true) };
    expect(next.toursSeen).toEqual({ games: 2 });
    expect(next.film).toEqual({ seat: 'ADC' });
    expect(next.tourSeen).toBe(true);
  });
});

/**
 * The document per team (27 Sep 2026, release 2). Firestore never runs here: the two doors, `readDoc` and
 * `writeDoc`, are stubbed on the prototype (the listeners spec's pattern), so what is pinned is the fields each
 * write carries. Bom Squad's film room stays in `film`, the shape every stored document has; another team's
 * lives in `teamFilm[id]` and is merged there alone; the chosen team is written and read back; and the local
 * mirror is one key per person with the whole document in it.
 */
type ReadDoc = (email: string) => Promise<UserPrefs | null>;
type WriteDoc = (email: string, fields: Record<string, unknown>, merge: boolean) => Promise<void>;

const EMAIL = 'a@example.com';
/** Let the awaits inside `load` run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('UserPrefsService, the document per team (release 2)', () => {
  const auth = {
    mode: 'firebase' as const,
    ready: signal(true),
    userEmail: signal<string | null>(null),
    /** Whether the person may see a team (release 3); every team unless a case says otherwise. */
    maySee: vi.fn<(teamId: string) => boolean>(() => true)
  };
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  /** What Firestore holds for the account. */
  let stored: UserPrefs | null;
  let readDoc: Mock<ReadDoc>;
  let writeDoc: Mock<WriteDoc>;

  function create(): UserPrefsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
    return TestBed.inject(UserPrefsService);
  }

  /** A fresh service, the account signed in and its document loaded. */
  async function signIn(): Promise<UserPrefsService> {
    auth.userEmail.set(null);
    const service = create();
    auth.userEmail.set(EMAIL);
    TestBed.tick();
    await settle();
    expect(service.loaded()).toBe(true);
    return service;
  }

  /** The last write's fields. */
  const lastWrite = () => writeDoc.mock.calls.at(-1)!;

  beforeEach(() => {
    localStorage.clear();
    auth.userEmail.set(null);
    auth.maySee.mockReset();
    auth.maySee.mockImplementation(() => true);
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    scope.choose.mockReset();
    scope.choose.mockImplementation((teamId) => scope.activeTeamId.set(teamId));
    stored = null;
    readDoc = vi.fn<ReadDoc>(async () => stored);
    writeDoc = vi.fn<WriteDoc>(async () => undefined);
    vi.spyOn(UserPrefsService.prototype as unknown as { readDoc: ReadDoc }, 'readDoc').mockImplementation(readDoc);
    vi.spyOn(UserPrefsService.prototype as unknown as { writeDoc: WriteDoc }, 'writeDoc').mockImplementation(writeDoc);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reads and writes Bom Squad's film room in `film`, the shape every stored document has", async () => {
    stored = { film: { seat: 'Jungle', films: { EUW1_1: { done: '2026-09-20T18:00:00.000Z' } } } };
    const service = await signIn();
    expect(readDoc).toHaveBeenCalledWith(EMAIL);
    expect(service.filmOf()).toEqual(stored.film);
    expect(service.filmSeat()).toBe('Jungle');
    expect(service.filmProgress('EUW1_1')?.done).toBe('2026-09-20T18:00:00.000Z');

    await service.setFilmSeat('Top');
    expect(lastWrite()).toEqual([EMAIL, { film: { seat: 'Top' } }, true]);

    await service.saveFilmProgress('EUW1_1', { asked: 1, nextAskAt: undefined });
    const [, fields, merge] = lastWrite();
    expect(merge).toBe(true);
    expect(Object.keys(fields)).toEqual(['film']);
    const patch = (fields as { film: { films: Record<string, Record<string, unknown>> } }).film.films['EUW1_1'];
    expect(patch['asked']).toBe(1);
    // A field cleared in the patch goes as a delete, never as undefined.
    expect(patch['nextAskAt']).toBeDefined();
    expect(service.prefs().film).toEqual({ seat: 'Top', films: { EUW1_1: { done: '2026-09-20T18:00:00.000Z', asked: 1 } } });
    expect(service.prefs().teamFilm).toBeUndefined();
  });

  it("keeps another team's film room in teamFilm[id], merged there alone, and leaves `film` as it was", async () => {
    stored = { film: { seat: 'Jungle', films: { EUW1_1: { done: '2026-09-20T18:00:00.000Z' } } } };
    const service = await signIn();
    scope.activeTeamId.set('b');
    // Nothing of Bom Squad's shows on team b.
    expect(service.filmOf()).toBeUndefined();
    expect(service.filmSeat()).toBeUndefined();
    expect(service.filmProgress('EUW1_1')).toBeUndefined();

    await service.setFilmSeat('Support');
    expect(lastWrite()).toEqual([EMAIL, { teamFilm: { b: { seat: 'Support' } } }, true]);
    await service.saveFilmProgress('EUW1_1', { calls: { board: 2 } });
    expect(lastWrite()).toEqual([EMAIL, { teamFilm: { b: { films: { EUW1_1: { calls: { board: 2 } } } } } }, true]);
    expect(service.filmSeat()).toBe('Support');
    expect(service.filmProgress('EUW1_1')).toEqual({ calls: { board: 2 } });
    expect(service.prefs().film).toEqual(stored.film);

    // Back on Bom Squad: its own seat and progress, nothing of team b's.
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    expect(service.filmSeat()).toBe('Jungle');
    expect(service.filmProgress('EUW1_1')).toEqual({ done: '2026-09-20T18:00:00.000Z' });

    // The mirror is one key per person, the whole document, both teams inside it.
    expect(localStorage.getItem('bom-tours:a@example.com:b')).toBeNull();
    expect(JSON.parse(localStorage.getItem(`bom-tours:${EMAIL}`)!)).toEqual(service.prefs());
  });

  it('setTeam writes the chosen team, and Bom Squad as the literal default, so another device can be pulled back to it', async () => {
    const service = await signIn();
    // The switcher tells the scope beside this; nothing here chooses on its own.
    scope.activeTeamId.set('b');
    await service.setTeam('b');
    expect(service.prefs().team).toBe('b');
    expect(lastWrite()).toEqual([EMAIL, { team: 'b' }, true]);

    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    await service.setTeam(DEFAULT_TEAM_ID);
    // Not a delete: a document with no team leaves a device where it is, and "chose Bom Squad" must not read as
    // "never chose", or the desktop would stay on b after the laptop went back.
    expect(service.prefs().team).toBe(DEFAULT_TEAM_ID);
    expect(lastWrite()).toEqual([EMAIL, { team: DEFAULT_TEAM_ID }, true]);

    await expect(service.setTeam('B')).rejects.toThrow();
    expect(scope.choose).not.toHaveBeenCalled();
  });

  it("follows the document's team when it names one the device did not choose, the default included", async () => {
    stored = { team: 'b' };
    await signIn();
    expect(scope.choose).toHaveBeenCalledTimes(1);
    expect(scope.choose).toHaveBeenCalledWith('b');
    expect(scope.activeTeamId()).toBe('b');

    // The other way round: this device is on b, and on another the person chose Bom Squad.
    scope.choose.mockClear();
    scope.activeTeamId.set('b');
    stored = { team: DEFAULT_TEAM_ID };
    await signIn();
    expect(scope.choose).toHaveBeenCalledTimes(1);
    expect(scope.choose).toHaveBeenCalledWith(DEFAULT_TEAM_ID);
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    // And nothing is written back: the document already says so.
    expect(writeDoc).not.toHaveBeenCalled();
  });

  it('leaves the device where the active-team rule put it when the document names a team the person may not see (release 3)', async () => {
    // Taken off b since the document was written, or the root named by a person on other teams alone.
    auth.maySee.mockImplementation((teamId) => teamId !== 'b' && teamId !== DEFAULT_TEAM_ID);
    stored = { team: 'b' };
    await signIn();
    expect(auth.maySee).toHaveBeenCalledWith('b');
    expect(scope.choose).not.toHaveBeenCalled();
    scope.activeTeamId.set('c');
    stored = { team: DEFAULT_TEAM_ID };
    await signIn();
    expect(scope.choose).not.toHaveBeenCalled();
    expect(scope.activeTeamId()).toBe('c');
  });

  it('leaves the device where it was when the document has no team, the same team, or a value that is not a team id', async () => {
    for (const doc of [{}, { team: 'default' }, { team: 'B' }, { film: { seat: 'Mid' } }] as UserPrefs[]) {
      stored = doc;
      await signIn();
      expect(scope.choose, JSON.stringify(doc)).not.toHaveBeenCalled();
      expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    }
    scope.activeTeamId.set('b');
    stored = { team: 'b' };
    await signIn();
    expect(scope.choose).not.toHaveBeenCalled();
  });

  it('resetTours writes the whole document back with the film rooms, the team and the reading depth riding along', async () => {
    stored = { toursSeen: { welcome: 2 }, tourSeen: true, film: { seat: 'Mid' }, teamFilm: { b: { seat: 'ADC' } }, team: 'b', depth: { games: 'full' } };
    const service = await signIn();
    await service.resetTours();
    expect(service.seenVersion('welcome')).toBe(0);
    expect(service.depthOf('games')).toBe('full');
    expect(lastWrite()).toEqual([
      EMAIL,
      { toursSeen: {}, tourSeen: false, film: { seat: 'Mid' }, teamFilm: { b: { seat: 'ADC' } }, team: 'b', depth: { games: 'full' } },
      false
    ]);
    // A document with none of them writes none of them (the mirror the first sign-in wrote is cleared, or the
    // local copy would carry them in, which is its job).
    localStorage.clear();
    stored = { toursSeen: { welcome: 2 } };
    const bare = await signIn();
    await bare.resetTours();
    expect(lastWrite()).toEqual([EMAIL, { toursSeen: {}, tourSeen: false }, false]);
  });

  /** A read the spec holds open, so what happens while it is in flight can be driven. */
  function holdRead(): (doc: UserPrefs | null) => void {
    let resolve!: (doc: UserPrefs | null) => void;
    readDoc.mockImplementationOnce(() => new Promise<UserPrefs | null>((r) => (resolve = r)));
    return (doc) => resolve(doc);
  }

  it('drops a read that outlived its sign-in: another account on the same tab gets neither its prefs nor its team', async () => {
    const resolveA = holdRead();
    auth.userEmail.set(null);
    const service = create();
    auth.userEmail.set(EMAIL);
    TestBed.tick();
    expect(service.loaded()).toBe(false);

    // A's read is still in flight (offline, the SDK holds one for about ten seconds) when A signs out and B signs in.
    auth.userEmail.set(null);
    TestBed.tick();
    stored = { toursSeen: { welcome: 1 } };
    auth.userEmail.set('b@example.com');
    TestBed.tick();
    await settle();
    expect(service.loaded()).toBe(true);
    expect(service.prefs()).toEqual({ toursSeen: { welcome: 1 } });

    // Then A's document arrives, naming a team. `choose` would write it under whoever is signed in now.
    resolveA({ team: 'b', film: { seat: 'Top' } });
    await settle();
    expect(scope.choose).not.toHaveBeenCalled();
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    expect(service.prefs()).toEqual({ toursSeen: { welcome: 1 } });
  });

  it('lets a choice made while the read was in flight stand over the team the document names', async () => {
    // This device's stored choice is b.
    scope.activeTeamId.set('b');
    const resolveRead = holdRead();
    auth.userEmail.set(null);
    const service = create();
    auth.userEmail.set(EMAIL);
    TestBed.tick();

    // Meanwhile the teams list found b gone and sent the scope back (TeamDataService's fallback); later, the switcher.
    scope.choose(DEFAULT_TEAM_ID);
    scope.choose.mockClear();
    resolveRead({ team: 'b', toursSeen: { welcome: 2 } });
    await settle();
    expect(service.loaded()).toBe(true);
    expect(scope.choose).not.toHaveBeenCalled();
    expect(scope.activeTeamId()).toBe(DEFAULT_TEAM_ID);
    // The rest of the document still lands; the team it names does not come back into memory over the choice.
    expect(service.seenVersion('welcome')).toBe(2);
    expect('team' in service.prefs()).toBe(false);
    expect(writeDoc).not.toHaveBeenCalled();
  });

  it('corrects the document when the teams list sent the scope back to the default, so the next sign-in does not bounce', async () => {
    stored = { team: 'b', film: { seat: 'Mid' } };
    const service = await signIn();
    expect(scope.activeTeamId()).toBe('b');
    expect(writeDoc).not.toHaveBeenCalled();

    // TeamDataService's fallback: b is not in the teams list any more.
    scope.choose(DEFAULT_TEAM_ID);
    TestBed.tick();
    await settle();
    expect(writeDoc).toHaveBeenCalledTimes(1);
    expect(lastWrite()).toEqual([EMAIL, { team: DEFAULT_TEAM_ID }, true]);
    expect(service.prefs().team).toBe(DEFAULT_TEAM_ID);
    expect(service.prefs().film).toEqual({ seat: 'Mid' });
    // Once: the corrected document asks for nothing more.
    TestBed.tick();
    await settle();
    expect(writeDoc).toHaveBeenCalledTimes(1);
  });

  it('empties on sign-out, so the next account starts with nothing of the last one', async () => {
    stored = { film: { seat: 'Mid' }, team: 'b' };
    const service = await signIn();
    auth.userEmail.set(null);
    TestBed.tick();
    expect(service.prefs()).toEqual({});
    expect(service.loaded()).toBe(false);
  });
});
