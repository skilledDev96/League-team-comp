import { describe, expect, it } from 'vitest';
import { classifyArchetype, describePlayer, PlayerAverages } from './insights';

function averages(over: Partial<PlayerAverages> = {}): PlayerAverages {
  return {
    games: 20,
    winRate: 50,
    avgKills: 5,
    avgDeaths: 4,
    avgAssists: 6,
    avgKda: 2.75,
    avgCsPerMin: 6,
    avgKillParticipation: 0.5,
    avgDamageShare: 0.2,
    avgTankShare: 0.2,
    avgBuildingDamage: 1000,
    avgVisionScore: 20,
    ...over
  };
}

describe('describePlayer', () => {
  it('reads a winning record as a strength and a losing one as a weakness', () => {
    expect(describePlayer(averages({ winRate: 60 }), []).strengths.join()).toMatch(/Positive win rate/);
    expect(describePlayer(averages({ winRate: 40 }), []).weaknesses.join()).toMatch(/Below 50%/);
  });

  it('treats exactly 50% as positive rather than negative', () => {
    // The boundary has to fall somewhere; it falls on the encouraging side.
    expect(describePlayer(averages({ winRate: 50 }), []).strengths.join()).toMatch(/Positive win rate/);
  });

  it('always says something about win rate, KDA and farming', () => {
    // Each is two-sided, so a card is never blank.
    const bad = describePlayer(averages({ winRate: 10, avgKda: 0.5, avgCsPerMin: 2 }), []);
    expect(bad.weaknesses).toHaveLength(3);
    expect(bad.strengths).toHaveLength(0);

    const good = describePlayer(averages({ winRate: 80, avgKda: 5, avgCsPerMin: 9 }), []);
    expect(good.strengths.length).toBeGreaterThanOrEqual(3);
  });

  it('mentions the champion pool only when there is one', () => {
    expect(describePlayer(averages(), ['Ahri']).strengths.join()).toMatch(/led by Ahri/);
    expect(describePlayer(averages(), []).strengths.join()).not.toMatch(/led by/);
  });

  it('flags high deaths', () => {
    expect(describePlayer(averages({ avgDeaths: 6 }), []).weaknesses.join()).toMatch(/High average deaths/);
    expect(describePlayer(averages({ avgDeaths: 3 }), []).weaknesses.join()).not.toMatch(/High average deaths/);
  });

  it('never shows more than three of either', () => {
    const worst = describePlayer(averages({ winRate: 5, avgKda: 0.2, avgCsPerMin: 1, avgDeaths: 12 }), ['Ahri']);
    expect(worst.weaknesses.length).toBeLessThanOrEqual(3);
    expect(worst.strengths.length).toBeLessThanOrEqual(3);
  });

  it('rounds the numbers it quotes to one decimal', () => {
    const text = describePlayer(averages({ avgKda: 3.14159 }), []).strengths.join();
    expect(text).toContain('3.1');
    expect(text).not.toContain('3.14159');
  });
});

describe('classifyArchetype', () => {
  it('calls every support Utility regardless of their numbers', () => {
    expect(classifyArchetype(averages({ avgDamageShare: 0.4 }), 'Support')).toBe('Utility');
  });

  it('calls a high-vision, low-damage player Utility whatever their role', () => {
    expect(classifyArchetype(averages({ avgVisionScore: 45, avgDamageShare: 0.1 }), 'Mid')).toBe('Utility');
  });

  it('recognises a frontline by damage taken against damage dealt', () => {
    expect(classifyArchetype(averages({ avgTankShare: 0.3, avgDamageShare: 0.15 }), 'Top')).toBe('Tank / Frontline');
  });

  it('recognises a split pusher by buildings and absence from fights', () => {
    expect(
      classifyArchetype(averages({ avgBuildingDamage: 2500, avgKillParticipation: 0.4 }), 'Top')
    ).toBe('Split Pusher');
  });

  it('recognises a carry by damage share and fight presence', () => {
    expect(
      classifyArchetype(averages({ avgDamageShare: 0.3, avgKillParticipation: 0.6 }), 'ADC')
    ).toBe('Carry');
  });

  it('checks the narrow rules before the broad ones', () => {
    // Split-pusher numbers that would also satisfy Farm-focused must not be
    // reclassified by the later, broader rule.
    const splitPusher = averages({ avgBuildingDamage: 2500, avgKillParticipation: 0.4, avgCsPerMin: 9 });
    expect(classifyArchetype(splitPusher, 'Top')).toBe('Split Pusher');
  });

  it('recognises a playmaker by assists outweighing kills', () => {
    expect(classifyArchetype(averages({ avgAssists: 9, avgKills: 4 }), 'Jungle')).toBe('Playmaker');
  });

  it('does not call someone a playmaker on ratio alone with few assists', () => {
    // 3 assists to 1 kill is the right shape but too little of it to mean much.
    expect(classifyArchetype(averages({ avgAssists: 3, avgKills: 1, avgKda: 2 }), 'Jungle')).not.toBe('Playmaker');
  });

  it('recognises a duelist by KDA when nothing more specific fits', () => {
    expect(classifyArchetype(averages({ avgKda: 4.5, avgAssists: 2, avgKills: 6 }), 'Mid')).toBe('Duelist');
  });

  it('falls back to a role generalist rather than guessing', () => {
    expect(classifyArchetype(averages(), 'Mid')).toBe('Mid Generalist');
    expect(classifyArchetype(averages(), 'Jungle')).toBe('Jungle Generalist');
  });

  it('always returns something', () => {
    const roles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const;
    for (const role of roles) {
      expect(classifyArchetype(averages(), role)).toBeTruthy();
    }
  });
});
