import { describe, expect, it } from 'vitest';
import { LaneParticipant, playerFacts, readLane, readLanes, TELEPORT_SUMMONER_ID } from './lane-read';
import { extractExtras } from './participant-extras';

const part = (over: Partial<LaneParticipant> & { teamId: number; teamPosition: string }): LaneParticipant => ({
  puuid: `${over.teamId}-${over.teamPosition}`,
  championName: 'X',
  kills: 0,
  deaths: 0,
  assists: 0,
  cs: 0,
  damage: 0,
  ...over
});

describe('extractExtras', () => {
  it('copies only finite numbers, from challenges and the top level, and never writes a zero for an absent field', () => {
    const got = extractExtras({
      challenges: { goldPerMinute: 412.5, soloKills: 2, teleportTakedowns: undefined, laneMinionsFirst10Minutes: 'n/a', damagePerMinute: NaN },
      goldEarned: 12_000,
      summoner1Id: 4,
      summoner2Id: 12,
      wardsPlaced: null
    });
    expect(got).toEqual({ goldPerMinute: 412.5, soloKills: 2, goldEarned: 12_000, summoner1Id: 4, summoner2Id: 12 });
  });

  it('is empty for a remake with no challenges block', () => {
    expect(extractExtras({ puuid: 'p' })).toEqual({});
  });
});

describe('readLane', () => {
  const ours = (extras: LaneParticipant['extras'], position = 'BOTTOM') =>
    part({ teamId: 100, teamPosition: position, championName: 'Jinx', extras });
  const theirs = (extras: LaneParticipant['extras'], position = 'BOTTOM') =>
    part({ teamId: 200, teamPosition: position, championName: 'Kaisa', extras });

  it('calls a lane won when gold and CS both clear the edge, even on gold alone, lost when mirrored', () => {
    const won = readLane(ours({ goldPerMinute: 430, laneMinionsFirst10Minutes: 80 }), theirs({ goldPerMinute: 400, laneMinionsFirst10Minutes: 72 }), 1800)!;
    expect(won).toMatchObject({ position: 'ADC', theirChampion: 'Kaisa', verdict: 'won', goldPerMinDiff: 30, csAt10Diff: 8 });
    const even = readLane(ours({ goldPerMinute: 430, laneMinionsFirst10Minutes: 75 }), theirs({ goldPerMinute: 400, laneMinionsFirst10Minutes: 72 }), 1800)!;
    expect(even.verdict).toBe('even');
    const lost = readLane(ours({ goldPerMinute: 400, laneMinionsFirst10Minutes: 72 }), theirs({ goldPerMinute: 430, laneMinionsFirst10Minutes: 80 }), 1800)!;
    expect(lost).toMatchObject({ verdict: 'lost', goldPerMinDiff: -30, csAt10Diff: -8 });
  });

  it("reads Riot's laning-phase flag as the third term", () => {
    const read = readLane(
      ours({ goldPerMinute: 431, laneMinionsFirst10Minutes: 70, laningPhaseGoldExpAdvantage: 1 }),
      theirs({ goldPerMinute: 400, laneMinionsFirst10Minutes: 70, laningPhaseGoldExpAdvantage: 0 }),
      1800
    )!;
    expect(read).toMatchObject({ verdict: 'won', laneAdvantage: true });
  });

  it('judges jungle and support on vision per minute, not CS', () => {
    const read = readLane(
      ours({ goldPerMinute: 340, visionScorePerMinute: 1.9, laneMinionsFirst10Minutes: 0 }, 'UTILITY'),
      theirs({ goldPerMinute: 300, visionScorePerMinute: 1.5, laneMinionsFirst10Minutes: 30 }, 'UTILITY'),
      1800
    )!;
    expect(read).toMatchObject({ position: 'Support', verdict: 'won', visionPerMinDiff: 0.4 });
  });

  it('is unknown under ten minutes, with no opponent, with no seat, or without gold on either side', () => {
    expect(readLane(ours({ goldPerMinute: 500, laneMinionsFirst10Minutes: 80 }), theirs({ goldPerMinute: 300, laneMinionsFirst10Minutes: 60 }), 500)!.verdict).toBe('unknown');
    expect(readLane(ours({ goldPerMinute: 500, laneMinionsFirst10Minutes: 80 }), theirs({ goldPerMinute: 300, laneMinionsFirst10Minutes: 60 }), 500)!.csAt10Diff).toBeUndefined();
    expect(readLane(ours({ goldPerMinute: 500 }), undefined, 1800)).toMatchObject({ verdict: 'unknown', theirChampion: '' });
    expect(readLane(ours({ goldPerMinute: 500 }, ''), theirs({}, ''), 1800)).toBeNull();
    const noGold = readLane(ours({ laneMinionsFirst10Minutes: 90 }), theirs({ laneMinionsFirst10Minutes: 60 }), 1800)!;
    expect(noGold.verdict).toBe('unknown');
    expect(noGold.goldPerMinDiff).toBeUndefined();
    expect(noGold.csAt10Diff).toBe(30);
  });

  it('falls back to gold and vision totals over the clock for a replay without per-minute figures', () => {
    const read = readLane(
      ours({ goldEarned: 15_000 }),
      { ...theirs({ goldEarned: 12_000 }), visionScore: 20 },
      1800
    )!;
    expect(read.goldPerMinDiff).toBe(100);
    expect(read.verdict).toBe('even'); // gold alone is one term
  });

  it('pairs by seat across the two teams and keys by puuid', () => {
    const lanes = readLanes(
      [
        part({ puuid: 'me-top', teamId: 100, teamPosition: 'TOP', extras: { goldPerMinute: 450, laneMinionsFirst10Minutes: 85 } }),
        part({ puuid: 'me-jg', teamId: 100, teamPosition: 'JUNGLE', extras: { goldPerMinute: 380 } }),
        part({ puuid: 'them-jg', teamId: 200, teamPosition: 'JUNGLE', championName: 'Lee Sin', extras: { goldPerMinute: 380 } }),
        part({ puuid: 'them-top', teamId: 200, teamPosition: 'TOP', championName: 'Sion', extras: { goldPerMinute: 400, laneMinionsFirst10Minutes: 70 } })
      ],
      100,
      1800
    );
    expect(lanes.get('me-top')).toMatchObject({ position: 'Top', theirChampion: 'Sion', verdict: 'won' });
    expect(lanes.get('me-jg')).toMatchObject({ position: 'Jungle', theirChampion: 'Lee Sin', verdict: 'even' });
    expect(lanes.has('them-top')).toBe(false);
  });
});

describe('playerFacts', () => {
  it('reads Teleport from either slot and keeps teleport takedowns only for a player who took it', () => {
    const withTp = playerFacts(part({ teamId: 100, teamPosition: 'TOP', extras: { summoner1Id: 4, summoner2Id: TELEPORT_SUMMONER_ID, teleportTakedowns: 2 } }), 1800);
    expect(withTp).toMatchObject({ hasTeleport: true, tpTakedowns: 2 });
    const without = playerFacts(part({ teamId: 100, teamPosition: 'TOP', extras: { summoner1Id: 4, summoner2Id: 14, teleportTakedowns: 0 } }), 1800);
    expect(without.hasTeleport).toBe(false);
    expect(without.tpTakedowns).toBeUndefined();
    expect(playerFacts(part({ teamId: 100, teamPosition: 'TOP' }), 1800).hasTeleport).toBeUndefined();
  });

  it('carries the rest as it is, per minute where Riot gives per minute, and from totals otherwise', () => {
    const facts = playerFacts(
      part({
        teamId: 100,
        teamPosition: 'UTILITY',
        visionScore: 60,
        extras: { goldEarned: 9_000, controlWardsPlaced: 5, wardTakedowns: 7, soloKills: 0, totalTimeSpentDead: 95, turretPlatesTaken: 1, teamDamagePercentage: 0.1234 }
      }),
      1800
    );
    expect(facts).toEqual({ goldPerMin: 300, visionPerMin: 2, controlWards: 5, wardTakedowns: 7, soloKills: 0, timeDeadSec: 95, plates: 1, damageShare: 0.123 });
  });
});
