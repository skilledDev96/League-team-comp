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

/** A scouted player as the offer needs them: a seat, a name to say it with, and whether they are a sub. */
export interface Seated extends Positioned {
  role: Role;
  name: string;
  sub?: boolean;
}

/** One seat the scouted games would move, and who holds it. */
export interface SeatChange<T> {
  player: T;
  from: Role;
  to: Role;
}

/**
 * The seats their games suggest, when those are not the seats somebody typed.
 *
 * An op.gg multi-link is not ordered by role, so pasting a roster in the wrong
 * order is the easy mistake — and when it happens every row of the table is
 * about the wrong player: the pool, the counters and the Plays column all read
 * off a seat that is not theirs, and the draft is prepared against it. Nothing
 * said so until now.
 *
 * Nothing unless there are exactly five starters. A roster with a sub has six
 * people for five seats, so "disagrees" is meaningless there — two of them
 * share a seat by definition, which is the truth of the roster and not an
 * error. Nothing either when the roster already agrees.
 *
 * This is an offer and must stay one (see `rolesDisagree`): a team that has
 * just swapped roles looks exactly like a roster pasted in the wrong order, and
 * only the person watching them knows which it is.
 */
export function seatOffer<T extends Seated>(players: readonly T[]): SeatChange<T>[] | null {
  const five = players.filter((p) => !p.sub);
  if (five.length !== 5) return null;
  if (!rolesDisagree(five)) return null;
  const suggested = assignRolesFromPlay(five);
  const changes = five
    .map((player, index) => ({ player, from: player.role, to: suggested[index] }))
    .filter((c) => c.from !== c.to);
  return changes.length ? changes : null;
}

/** The roster with an offer taken. Anyone the offer does not name — a sub, or a seat already right — is untouched. */
export function withSeats<T extends Seated>(players: readonly T[], changes: readonly SeatChange<T>[]): T[] {
  const moved = new Map<T, Role>(changes.map((c) => [c.player, c.to]));
  return players.map((p) => {
    const to = moved.get(p);
    return to ? { ...p, role: to } : p;
  });
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
