import { Player, Role, ROLES } from '../models/team.models';
import { profileSlugs } from '../pages/admin/admin-drafts';
import { EnrichResponse, mergeChampionPool } from '../services/player-enrichment.service';
import { RiotId } from './riot-id';

/**
 * The roster importer's plan (27 Sep 2026, the lead: paste an op.gg multi-link and
 * have the app populate itself). A pasted link, or a list of Name#TAG lines,
 * becomes the team's own players.
 *
 * Pure, the core/scrims-migration.ts pattern: this plans the writes and reads
 * Riot's answers, and RosterImportService performs the writes one by one through
 * TeamDataService. Only the pasted text is ever read (parseRiotIds in
 * core/riot-id.ts); op.gg is never fetched, which is what keeps the Riot key safe.
 */

/** The most players the comp analysis accepts (parseCompAnalysisRequest, api/src/analysis-cache.ts). */
export const MAX_ROSTER = 10;

export interface RosterCreate {
  id: RiotId;
  /** Where this Riot ID stood in the paste, which is the seat for the first five. */
  index: number;
  player: Omit<Player, 'id' | 'order'>;
}

export interface RosterSkip {
  id: RiotId;
  reason: 'already-on-roster';
}

export interface RosterImportPlan {
  creates: RosterCreate[];
  skips: RosterSkip[];
  /**
   * Why nothing may be written: nothing parsed, or the roster would pass the cap.
   * `creates` still lists what was read so a preview can say so; a caller writes
   * nothing while this is set.
   */
  refused?: string;
}

const riotKey = (name: string, tag: string) => `${name.trim()}#${tag.trim()}`.toLowerCase();

/**
 * Seats follow the paste order, top to support, the rule fromPaste already applies
 * to an opponent's link: a multi-link carries no roles and a team writes its roster
 * top to support almost every time. Past five everyone is a sub whose seat cycles
 * until Riot is read. A newcomer whose seat a starter already holds is a sub too
 * (Player.sub: two can share a seat and the sub never steals it).
 *
 * A Riot ID already on the roster is skipped, matched by lowercased name#tag, or by
 * the name alone when the stored player carries no tag, which is the safe direction:
 * a stored player without a tag cannot be told apart from the paste, so the paste
 * never doubles them.
 */
export function planRosterImport(input: { ids: readonly RiotId[]; existing: readonly Player[] }): RosterImportPlan {
  const withTag = new Set<string>();
  const withoutTag = new Set<string>();
  for (const p of input.existing) {
    const tag = p.profile?.riotTag?.trim();
    if (tag) withTag.add(riotKey(p.name, tag));
    else withoutTag.add(p.name.trim().toLowerCase());
  }
  const onRoster = (id: RiotId) => withTag.has(riotKey(id.name, id.tag)) || withoutTag.has(id.name.trim().toLowerCase());
  const held = new Set<Role>(input.existing.filter((p) => !p.sub).map((p) => p.role));

  const creates: RosterCreate[] = [];
  const skips: RosterSkip[] = [];
  for (const [index, id] of input.ids.entries()) {
    if (onRoster(id)) {
      skips.push({ id, reason: 'already-on-roster' });
      continue;
    }
    const role = ROLES[index % ROLES.length];
    const sub = index >= ROLES.length || held.has(role);
    creates.push({
      id,
      index,
      player: {
        name: id.name,
        role,
        ...(sub ? { sub: true } : {}),
        // Empty, and no `curated`: the morning job fills the text, the pool and the
        // bans and keeps doing so, since nobody has hand-edited this player.
        strengths: [],
        weaknesses: [],
        top3: [],
        bans: [],
        profile: { region: id.region ?? 'euw', riotTag: id.tag, ...profileSlugs(id.name, id.tag) }
      }
    });
  }

  let refused: string | undefined;
  const total = input.existing.length + creates.length;
  if (!input.ids.length) refused = 'No Riot ID could be read. Paste an op.gg multi-link, or one Name#TAG a line.';
  else if (total > MAX_ROSTER) refused = `That would put ${total} players on the roster and the analysis takes at most ${MAX_ROSTER}. Take some off first, or paste fewer.`;
  return refused ? { creates, skips, refused } : { creates, skips };
}

/**
 * The player after Riot answered: RefreshService.refreshPlayer's mapping plus the
 * refresh stamp, with one difference. A starter keeps the seat the paste gave them,
 * because Riot's most-played position is a suggestion and never written for a
 * starter; a sub's seat was only the cycled guess, so a sub takes Riot's. A template
 * answer (enrichPlayer answers 200 with one on any failure) leaves the player as it
 * is: invented strengths on a real person's row are worse than an empty one.
 *
 * A player hand-edited while Riot was being read (the read takes a minute, and the
 * service re-reads the live document before writing) is mergePlayer's curated
 * branch (api/src/daily-refresh.ts): the seat and the text are the editor's, only
 * the queue stats, a missing icon and the stamp are taken. Otherwise a sub's fresh
 * seat flipped to Riot's, with `curated` carried across so the morning job then
 * protected Riot's version instead of the editor's.
 */
export function applyEnrichment(player: Player, enriched: EnrichResponse, now: string, options: { starter: boolean }): Player {
  if (enriched.source !== 'provider') return player;
  if (player.curated) {
    return {
      ...player,
      icon: player.icon || enriched.iconUrl,
      queueStats: enriched.queueStats ?? player.queueStats,
      refreshedAt: now
    };
  }
  return {
    ...player,
    role: options.starter ? player.role : (enriched.role ?? player.role),
    icon: enriched.iconUrl ?? player.icon,
    playstyle: enriched.playstyle || player.playstyle,
    strengths: enriched.strengths.length ? enriched.strengths : player.strengths,
    weaknesses: enriched.weaknesses.length ? enriched.weaknesses : player.weaknesses,
    top3: mergeChampionPool(player.top3, enriched.top3),
    bans: enriched.bans?.length ? enriched.bans : player.bans,
    queueStats: enriched.queueStats ?? player.queueStats,
    refreshedAt: now
  };
}

/** The seat Riot sees this player in, when it is not the one they hold; null otherwise or off a template. */
export function seatSuggestion(player: Pick<Player, 'role'>, enriched: EnrichResponse): Role | null {
  if (enriched.source !== 'provider' || !enriched.role) return null;
  return enriched.role === player.role ? null : enriched.role;
}

export interface DetectedSeat {
  playerId: string;
  sub?: boolean;
  /** Riot's most-played position for this player; absent or null when the read failed. */
  detected?: Role | null;
}

/**
 * The seats for "Seat by Riot's roles": one per starter, only when exactly five
 * starters were read and Riot put them in five different seats. Two starters Riot
 * sees in the same seat is a question for a person, not a rule, so that is null.
 */
export function seatsFromDetected(rows: readonly DetectedSeat[]): Record<string, Role> | null {
  const starters = rows.filter((r) => !r.sub);
  if (starters.length !== ROLES.length) return null;
  const seats: Record<string, Role> = {};
  const taken = new Set<Role>();
  for (const row of starters) {
    if (!row.detected || taken.has(row.detected)) return null;
    taken.add(row.detected);
    seats[row.playerId] = row.detected;
  }
  return seats;
}

export type FailureKind = 'unknown-id' | 'no-games' | 'key' | 'rate' | 'local' | 'other';

export interface FailureReason {
  kind: FailureKind;
  text: string;
}

/**
 * Why a read came back as a template. enrichPlayer never fails the request: on any
 * error it answers a role template with the reason in `provider`, as
 * `template-fallback: <reason>`, where the reason is riotError's wording
 * (api/src/riot-errors.ts) or the enrichment's own. The frontend's local-mode
 * fallback is the bare `built-in-role-template`.
 */
export function failureReason(provider: string): FailureReason {
  const reason = (provider ?? '').replace(/^template-fallback:\s*/, '').trim();
  // The functions join the three queues' reasons with "; " (fetchRiotEnrichment in
  // api/src/index.ts), so these are substring tests over the joined line, and the
  // order matters: a 429 on one queue next to "no match history" on the other two
  // means the read was incomplete, not that there are no games, so the rate limit
  // is asked before the no-games line.
  if (/\(404\) on account-v1/.test(reason)) {
    return { kind: 'unknown-id', text: 'Riot does not know this Riot ID. Check the name and the tag.' };
  }
  if (/\((401|403)\)/.test(reason)) {
    return { kind: 'key', text: 'Riot refused the key. Check it on Admin › Diagnostics.' };
  }
  if (/RIOT_API_KEY not configured/.test(reason)) {
    return { kind: 'key', text: 'The functions have no Riot key configured.' };
  }
  if (/\(429\)/.test(reason)) {
    return { kind: 'rate', text: 'Riot held the rate limit for the whole read. Try again in a couple of minutes.' };
  }
  if (/No recent ranked\/normal match history/.test(reason)) {
    return { kind: 'no-games', text: 'No recent ranked or normal games to read yet.' };
  }
  if (reason === 'built-in-role-template') {
    return { kind: 'local', text: 'Local preview has no Riot access; the profile stays empty.' };
  }
  return { kind: 'other', text: reason ? `Riot could not be read: ${reason}` : 'Riot returned nothing useful.' };
}
