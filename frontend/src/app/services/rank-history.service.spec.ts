import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { DEFAULT_TEAM_ID } from '../core/team-scope';
import { RankHistoryDoc } from '../models/team.models';
import { AuthService } from './auth.service';
import { RankHistoryService } from './rank-history.service';
import { TeamScopeService } from './team-scope.service';

/**
 * The rank climb's reader (27 Sep 2026, release 2). Firestore never runs here: the one document
 * read is a method stubbed on the instance, and what is pinned is the path it is asked for, which
 * for Bom Squad is the literal `rankHistory/{playerId}` it always was, and that a team switch or an
 * account change empties what was read, so a shared player id can never show another team's climb.
 */

type Read = (path: string) => Promise<RankHistoryDoc | null>;

const history = {
  playerId: 'p1',
  points: [{ at: '2026-09-27', queue: 'solo', tier: 'GOLD', rank: 'II', lp: 40 }],
  updatedAt: '2026-09-27T06:30:00.000Z'
} as unknown as RankHistoryDoc;

describe('RankHistoryService', () => {
  const auth = { mode: 'firebase' as const, userEmail: signal<string | null>('a@example.com') };
  /** The scope as the test drives it; the real one follows the account and localStorage (its own spec). */
  const scope = { activeTeamId: signal(DEFAULT_TEAM_ID), choose: vi.fn<(teamId: string) => void>() };
  let read: Mock<Read>;

  function create(): RankHistoryService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: TeamScopeService, useValue: scope }
      ]
    });
    const service = TestBed.inject(RankHistoryService);
    (service as unknown as { read: Read }).read = read;
    return service;
  }

  beforeEach(() => {
    localStorage.clear();
    auth.userEmail.set('a@example.com');
    scope.activeTeamId.set(DEFAULT_TEAM_ID);
    read = vi.fn<Read>(async (path) => (path.endsWith('/p1') ? history : null));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reads Bom Squad's history at rankHistory/{playerId}, the literal path it always was, and once", async () => {
    const service = create();
    expect(await service.load('p1')).toEqual(history);
    expect(await service.load('p1')).toEqual(history);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('rankHistory/p1');
    expect(service.known().get('p1')).toEqual(history);
  });

  it('reads every player together, and remembers who has no history rather than asking twice', async () => {
    const service = create();
    await service.loadAll(['p1', 'p2']);
    expect(read.mock.calls.map((c) => c[0])).toEqual(['rankHistory/p1', 'rankHistory/p2']);
    expect(service.known().get('p2')).toBeNull();
    expect(await service.load('p2')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads another team's history under its prefix", async () => {
    scope.activeTeamId.set('b');
    const service = create();
    expect(await service.load('p1')).toEqual(history);
    expect(read).toHaveBeenCalledWith('teams/b/rankHistory/p1');
  });

  it("empties what was read when the team changes, and reads the new team's documents afresh", async () => {
    const service = create();
    await service.load('p1');
    // The effect running with nothing changed keeps what was read.
    TestBed.tick();
    expect(service.known().size).toBe(1);

    scope.activeTeamId.set('b');
    TestBed.tick();
    expect(service.known().size).toBe(0);
    await service.load('p1');
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith('teams/b/rankHistory/p1');
  });

  it('empties on sign-out, so the next account starts with nothing of the last one', async () => {
    const service = create();
    await service.load('p1');
    auth.userEmail.set(null);
    TestBed.tick();
    expect(service.known().size).toBe(0);
  });

  it("keeps a read that was in flight when the team changed off the new team's map", async () => {
    let answer!: (h: RankHistoryDoc | null) => void;
    read.mockImplementationOnce(() => new Promise<RankHistoryDoc | null>((resolve) => (answer = resolve)));
    const service = create();
    const pending = service.load('p1');
    scope.activeTeamId.set('b');
    TestBed.tick();
    answer(history);
    // Whoever asked on the old team still gets the old team's answer; the map holds nothing of it.
    expect(await pending).toEqual(history);
    expect(service.known().size).toBe(0);
    await service.load('p1');
    expect(read).toHaveBeenLastCalledWith('teams/b/rankHistory/p1');
    expect(service.known().get('p1')).toEqual(history);
  });
});
