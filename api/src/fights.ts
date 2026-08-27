/**
 * What happened in the fights, read from the scoreline both teams put up.
 *
 * The objective factors answer where a game was decided on the map. They cannot
 * tell a loss where the team was winning skirmishes and failing to convert them
 * from one where the team was simply being killed — and those two need opposite
 * work. The kill tally separates them, and it costs nothing: every participant
 * is already cached, so this reads data we hold rather than fetching more.
 */

/** Only the fields the tally reads; callers pass richer participants. */
export interface FightParticipant {
  teamId: number;
  kills: number;
  assists: number;
}

export interface FightTally {
  ours: number;
  theirs: number;
}

export function tallyKills(
  participants: FightParticipant[],
  rosterTeamId: number
): FightTally {
  let ours = 0;
  let theirs = 0;
  for (const p of participants) {
    if (p.teamId === rosterTeamId) ours += p.kills;
    else theirs += p.kills;
  }
  return { ours, theirs };
}

/**
 * Share of a game's kills that went our way, or null when there were too few
 * kills to mean anything.
 *
 * A share rather than a margin, because a margin does not travel: eight kills
 * up is a rout at twenty minutes and noise at fifty. The floor exists because
 * 3-1 is the same share as 30-10 and nothing like the same claim.
 */
const MIN_KILLS = 10;

export function killShare(tally: FightTally): number | null {
  const total = tally.ours + tally.theirs;
  if (total < MIN_KILLS) return null;
  return tally.ours / total;
}

/**
 * How much of the team's kills a player was there for.
 *
 * Computed rather than taken from Riot's `challenges.killParticipation`, which
 * is absent on older matches — and this is the same number from data already
 * cached, so it works on every game rather than only the recent ones.
 *
 * Returns null for a game with no kills at all, where the question is empty
 * rather than zero.
 */
export function killParticipation(
  kills: number,
  assists: number,
  teamKills: number
): number | null {
  if (teamKills <= 0) return null;
  return Math.min(1, (kills + assists) / teamKills);
}
