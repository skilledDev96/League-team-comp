import { Role, ROLES } from '../models/team.models';

/**
 * Working out which seat each of their players is actually in.
 *
 * A roster link carries no roles, so pasting one assigns them by position and
 * hopes the team wrote itself down top to support. Teams routinely do not: an
 * ADC moves to top, a support to jungle, and the whole roster is off by one in
 * a way that quietly points every scouting row at the wrong lane.
 *
 * Once scouted there is no need to guess. Riot reports the positions each
 * player actually played and how often, which answers the question directly.
 */

export interface Positioned {
  /** Positions played, most often first, with the games behind each. */
  readonly positions?: readonly { role: Role; games: number }[];
}

/**
 * Assign one seat per player from what they actually play.
 *
 * Greedy by confidence: every (player, role) pairing is ranked by games and
 * taken in that order, so the strongest claim on a seat wins it. A support with
 * 60 games there beats a mid with 3 games of support, and the loser falls to
 * their next real position rather than to whatever is left over.
 *
 * Five players and five seats, so somebody must take a seat they do not play if
 * two genuinely main the same one. Those are filled last, from the seats
 * nobody claimed — a guess, but a guess that cannot displace a real answer.
 *
 * Players with no scouted positions keep the role they already had where that
 * seat is free, since a human may have set it deliberately.
 */
export function assignRolesFromPlay(players: readonly (Positioned & { role?: Role })[]): Role[] {
  const out: (Role | undefined)[] = players.map(() => undefined);
  const takenRoles = new Set<Role>();

  const claims = players
    .flatMap((player, index) =>
      (player.positions ?? []).map((p) => ({ index, role: p.role, games: p.games }))
    )
    .filter((c) => c.games > 0)
    .sort((a, b) => b.games - a.games);

  for (const claim of claims) {
    if (out[claim.index] || takenRoles.has(claim.role)) continue;
    out[claim.index] = claim.role;
    takenRoles.add(claim.role);
  }

  // Anyone unscouted keeps what they had, if that seat survived the claims.
  players.forEach((player, index) => {
    if (out[index] || !player.role || takenRoles.has(player.role)) return;
    out[index] = player.role;
    takenRoles.add(player.role);
  });

  // Whatever is left, to whoever is left. Order only, never over a real answer.
  const spare = ROLES.filter((role) => !takenRoles.has(role));
  return out.map((role) => role ?? spare.shift() ?? ROLES[0]);
}

/**
 * Whether the roles on the roster disagree with what the players actually play.
 *
 * Drives an offer, never a rewrite. A disagreement does not mean the roster is
 * wrong: a team that has just swapped roles has exactly this shape, and their
 * history describes where they *used* to play. Only the person watching them
 * knows which it is.
 */
export function rolesDisagree(players: readonly (Positioned & { role?: Role })[]): boolean {
  const suggested = assignRolesFromPlay(players);
  return players.some((player, index) => player.role !== suggested[index]);
}

/**
 * The seat this player's scouted history is actually about, when that is not
 * the seat they have been given.
 *
 * The reason this matters is the champion pool. Everything scouted — the pool,
 * the lane counters — comes from games in whatever role they were playing then.
 * Put a career ADC at top and their five most-played champions are ADCs: still
 * true, and no longer a prediction of what they will pick. Saying so is the
 * difference between a stale pool and a misleading one.
 */
export function playedElsewhere(
  player: Positioned & { role?: Role }
): { role: Role; games: number } | null {
  const main = (player.positions ?? []).filter((p) => p.games > 0)[0];
  if (!main || !player.role || main.role === player.role) return null;
  return { role: main.role, games: main.games };
}
