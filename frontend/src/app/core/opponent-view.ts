import { ChampionRecord, OpponentPlayer, ROLES, Role } from '../models/team.models';
import { playsRole } from './champion-lanes';

/**
 * Reading a scouted opponent for display.
 *
 * Shared by the tournament plan and the scrims page, which show the same
 * roster table for the same reason: a team we scout for a scrim is the same
 * team if they show up in the bracket. One implementation, so the seat swap,
 * the queue split and the lane filter cannot drift between the two.
 *
 * Everything here is pure and takes the roster or a player, never a series or
 * a scrim opponent — the caller owns where the result is written back.
 */

/**
 * Their five, in seat order rather than the order the link was pasted in.
 *
 * Once seats are set by hand the paste order means nothing, and a roster read
 * top-to-support is the one shape everybody already knows how to scan.
 */
export function orderedRoster(players: readonly OpponentPlayer[]): OpponentPlayer[] {
  // Seat order, and within a seat the starter before the sub, so a six-player
  // roster reads as five seats with the bench underneath, not as two ADCs.
  return [...players].sort(
    (a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || Number(!!a.sub) - Number(!!b.sub)
  );
}

/** The five they field — everyone not flagged as a sub — in seat order. */
export function starters(players: readonly OpponentPlayer[]): OpponentPlayer[] {
  return orderedRoster(players.filter((p) => !p.sub));
}

/**
 * Their bench, in seat order. Kept off the table and off the ban board so
 * five seats read as five; a sub is one line under the table until promoted.
 */
export function bench(players: readonly OpponentPlayer[]): OpponentPlayer[] {
  return orderedRoster(players.filter((p) => p.sub));
}

/**
 * Flag one of their players as the substitute, or clear it. Found by identity
 * like reseatOpponent; returns null when nothing would change. The flag is
 * dropped rather than written false, so an untouched roster stays untouched.
 */
export function setSubstitute(
  players: readonly OpponentPlayer[],
  player: OpponentPlayer,
  sub: boolean
): OpponentPlayer[] | null {
  const index = players.findIndex((p) => p.name === player.name && p.riotTag === player.riotTag);
  if (index < 0 || !!players[index].sub === sub) return null;
  const roster = [...players];
  const { sub: _was, ...rest } = roster[index];
  roster[index] = sub ? { ...rest, sub: true } : rest;
  return roster;
}

/**
 * Move one of their players to a different seat, swapping with whoever had it.
 *
 * Set by hand, never inferred: a team that has just swapped roles looks
 * identical to a roster pasted in the wrong order, and only somebody who has
 * watched them knows which it is.
 *
 * Found by identity, never by index. The rows are sorted by seat for display,
 * so the position on screen is not the position in the stored array — passing
 * the row index once moved a *different* player, and two of them ended up in
 * the same seat with a seat left empty.
 *
 * Returns null when nothing changes, so the caller can skip the write.
 */
export function reseatOpponent(
  players: readonly OpponentPlayer[],
  player: OpponentPlayer,
  role: Role
): OpponentPlayer[] | null {
  const roster = [...players];
  const index = roster.findIndex((p) => p.name === player.name && p.riotTag === player.riotTag);
  const current = roster[index];
  if (!current || current.role === role) return null;

  // Five players hold five seats, so taking one has to hand the old seat to
  // whoever had it. A roster with subs is different: six players cannot all
  // hold distinct seats, so displacing whoever had the role would shuffle a
  // starter into a sub's old slot for no reason. With subs, a seat is simply
  // set, and two players sharing a role is the truth of the roster.
  if (roster.length <= ROLES.length) {
    const holder = roster.findIndex((p, i) => i !== index && p.role === role);
    if (holder >= 0) roster[holder] = { ...roster[holder], role: current.role };
  }
  roster[index] = { ...current, role };
  return roster;
}

/**
 * Add players to a roster without replacing it.
 *
 * For the sub who was not in the multi-link, or the one name that was missed.
 * Anyone already on the roster is skipped, so pasting the same link twice is
 * harmless. A new player lands on the role with the fewest holders, so a sixth
 * name goes to a sensible seat rather than always to Top.
 */
export function appendToRoster(
  incoming: readonly { name: string; tag: string; region?: string }[],
  existing: readonly OpponentPlayer[]
): OpponentPlayer[] {
  const have = new Set(existing.map((p) => `${p.name}#${p.riotTag ?? ''}`.toLowerCase()));
  const fresh = incoming.filter((id) => !have.has(`${id.name}#${id.tag}`.toLowerCase()));
  if (!fresh.length) return [...existing];

  const counts = new Map<Role, number>(ROLES.map((r) => [r, 0]));
  for (const p of existing) counts.set(p.role, (counts.get(p.role) ?? 0) + 1);

  const added = fresh.map((id) => {
    const role = [...counts.entries()].sort(
      (a, b) => a[1] - b[1] || ROLES.indexOf(a[0]) - ROLES.indexOf(b[0])
    )[0][0];
    counts.set(role, (counts.get(role) ?? 0) + 1);
    return { role, name: id.name, riotTag: id.tag, region: id.region ?? 'euw' } as OpponentPlayer;
  });
  return [...existing, ...added];
}

/** How long since the roster was last scouted, as words; empty if never. */
export function scoutedAgo(players: readonly OpponentPlayer[], now: number = Date.now()): string {
  const stamps = players
    .map((p) => p.scoutedAt)
    .filter((at): at is string => !!at)
    .sort();
  if (!stamps.length) return '';

  const days = Math.floor((now - Date.parse(stamps[stamps.length - 1])) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** What they play in the seat they hold, falling back to their history. */
export function poolFor(player: OpponentPlayer): ChampionRecord[] {
  const seat = player.role ? player.poolByRole?.[player.role] : undefined;
  if (seat?.length) return seat.slice(0, 5);

  // Rosters scouted before records existed carry names only; show those
  // rather than nothing, with no numbers to go with them.
  const overall = player.championRecords?.length
    ? player.championRecords
    : (player.top3 ?? []).map((champion) => ({ champion, games: 0, wins: 0 }));
  return overall.slice(0, 5);
}

/** Who beats them in the seat they hold, falling back to their history. */
export function countersFor(player: OpponentPlayer): ChampionRecord[] {
  const seat = player.role ? player.bansByRole?.[player.role] : undefined;
  if (seat?.length) return seat.slice(0, 4);
  return (player.bans ?? []).slice(0, 4).map((champion) => ({ champion, games: 0, wins: 0 }));
}

/** Whether the pool shown is the seat they hold, or their history at large. */
export function poolIsForSeat(player: OpponentPlayer): boolean {
  return !!(player.role && player.poolByRole?.[player.role]?.length);
}

export function countersAreForSeat(player: OpponentPlayer): boolean {
  return !!(player.role && player.bansByRole?.[player.role]?.length);
}

/** A win rate, or nothing when the record is too thin to carry one. */
export function rateOf(r: ChampionRecord): number | null {
  return r.games > 0 ? Math.round((r.wins / r.games) * 100) : null;
}

/** Colour band for a champion win rate, matching the draft panel. */
export function rateBand(r: ChampionRecord): string {
  const rate = rateOf(r);
  if (rate === null) return '';
  if (rate >= 65) return 'is-good';
  if (rate > 50) return 'is-ok';
  if (rate === 50) return 'is-even';
  return 'is-poor';
}

export interface QueueRow {
  /** Games read against games listed, when the record knows. */
  sample?: { read: number; available: number; unread: number };
  key: 'solo' | 'flex' | 'all';
  label: string;
  rank?: string;
  record?: string;
  pool: ChampionRecord[];
  counters: ChampionRecord[];
  forSeat: boolean;
}

/**
 * The rows to render for one scouted player — one per ranked queue.
 *
 * Solo and flex are different pools. The backend merge preferred flex and
 * discarded solo, so a row labelled "plays" was showing half the picture with
 * nothing saying which half. Both are now carried, and both are shown.
 *
 * Falls back to a **single** row for anyone scouted before the split existed:
 * they have no `byQueue`, and rendering two empty rows for every stored roster
 * would look like the feature is broken rather than like the data predates it.
 * Re-scouting fills them in.
 */
export function queueRows(player: OpponentPlayer): QueueRow[] {
  const byQueue = player.byQueue;
  if (!byQueue?.solo && !byQueue?.flex) {
    return [
      {
        key: 'all',
        label: '',
        rank: player.soloRank ?? player.flexRank ?? player.rank,
        record: player.soloRecord ?? player.flexRecord,
        pool: poolFor(player),
        counters: countersFor(player),
        forSeat: poolIsForSeat(player)
      }
    ];
  }

  const row = (key: 'solo' | 'flex', label: string, rank?: string, record?: string): QueueRow => {
    const queue = byQueue[key];
    const seatPool = player.role ? queue?.poolByRole?.[player.role] : undefined;
    const seatBans = player.role ? queue?.bansByRole?.[player.role] : undefined;
    return {
      key,
      label,
      rank,
      record,
      pool: (seatPool?.length ? seatPool : (queue?.championRecords ?? [])).slice(0, 5),
      counters: (seatBans?.length
        ? seatBans
        : (queue?.bans ?? []).map((champion) => ({ champion, games: 0, wins: 0 }))
      ).slice(0, 4),
      forSeat: !!seatPool?.length,
      sample: queue?.sample
    };
  };

  return [
    row('solo', 'Solo', player.soloRank, player.soloRecord),
    row('flex', 'Flex', player.flexRank, player.flexRecord)
  ];
}

/** One champion worth banning, and the player it would take it from. */
export interface BanCandidate {
  champion: string;
  player: string;
  role: Role;
  games: number;
  wins: number;
  /** Rounded percentage; 0 when there is no record behind the name. */
  winRate: number;
}

/**
 * The champions across their five that a ban would actually hurt.
 *
 * The roster table shows everything and so answers nothing: deciding who to
 * ban meant scanning two rows of small icons per player. This is the answer
 * the table exists to give — for each player, the champion they play most in
 * their seat with both queues added together, ranked by games because a ban
 * is aimed at comfort, with win rate beside it for the judgement call. Two per
 * player go in, so a genuine two-champion player shows both; the top few
 * across the team come out.
 *
 * Games first, win rate to break ties. A 100% over three games is a curiosity;
 * a 52% over twenty-one is what they will pick under pressure.
 */
export function banCandidates(players: readonly OpponentPlayer[], limit = 6): BanCandidate[] {
  const out: BanCandidate[] = [];
  for (const player of players) {
    if (player.sub) continue; // the board answers "who do we ban of the five"
    const merged = new Map<string, { games: number; wins: number }>();
    for (const row of queueRows(player)) {
      for (const rec of row.pool) {
        const m = merged.get(rec.champion) ?? { games: 0, wins: 0 };
        m.games += rec.games;
        m.wins += rec.wins;
        merged.set(rec.champion, m);
      }
    }
    const theirs = [...merged.entries()]
      .map(([champion, { games, wins }]) => ({
        champion,
        player: player.name,
        role: player.role,
        games,
        wins,
        winRate: games ? Math.round((wins / games) * 100) : 0
      }))
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    out.push(...theirs.slice(0, 2));
  }
  return out.sort((a, b) => b.games - a.games || b.winRate - a.winRate).slice(0, limit);
}

/**
 * What they have played lately **in this seat**.
 *
 * `recentChampions` comes from champion mastery, which carries no position at
 * all — so the raw list put a support and a jungler in a top laner's row and
 * read as noise. Narrowed through the pro-play lane map, which is deliberately
 * generous: a champion with no pro games passes every lane rather than none,
 * so this can never hide a pocket pick it has simply never seen.
 *
 * Falls back to the unfiltered list when the filter empties it. A player whose
 * recent games are all off-seat is telling you something — most likely that
 * the seat we have them in is wrong — and an empty cell says nothing.
 */
export function recentForSeat(player: OpponentPlayer): string[] {
  const all = player.recentChampions ?? [];
  if (!all.length) return [];
  const inSeat = all.filter((champion) => playsRole(champion, player.role));
  return (inSeat.length ? inSeat : all).slice(0, 6);
}

/**
 * How many recent champions were dropped as off-seat.
 *
 * The off-seat count only — not the six-icon cap, which is a display limit
 * rather than a claim about the player. Zero when the filter emptied the list
 * and the row fell back to showing everything, because then nothing was hidden.
 */
export function recentHidden(player: OpponentPlayer): number {
  const all = player.recentChampions ?? [];
  const inSeat = all.filter((champion) => playsRole(champion, player.role));
  return inSeat.length ? all.length - inSeat.length : 0;
}
