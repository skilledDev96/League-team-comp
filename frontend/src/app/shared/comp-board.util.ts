/**
 * The rules behind the comp board: which slot the next pick lands in, and what
 * the champion grid shows.
 *
 * Kept out of the component because these are the parts that decide whether
 * building a comp takes two clicks or six, and they are worth pinning with
 * tests rather than discovering by clicking.
 */

import { ChampionInfo } from '../services/champion-data.service';
import { ChampionTraits, CompPicks, Role, ROLES } from '../models/team.models';

/**
 * Champion traits, re-keyed so they can be read with a Data Dragon id.
 *
 * The stored map is keyed on CommunityDragon's `alias`; every lookup uses the
 * Data Dragon id. Those are two namespaces that agree on 172 of 173 champions
 * and disagree on exactly one: CommunityDragon spells it `FiddleSticks`, Data
 * Dragon `Fiddlesticks`. A case-sensitive read therefore drops Fiddlesticks and
 * nothing else — and because the identity label needs all five champions, one
 * missing champion hides the label for the whole comp rather than for one slot.
 *
 * Lowercasing both sides is the fix, and it also absorbs the next such drift
 * without anyone having to notice it happened.
 */
export function indexTraits(
  map: Record<string, ChampionTraits>
): Record<string, ChampionTraits> {
  const out: Record<string, ChampionTraits> = {};
  for (const key of Object.keys(map)) {
    out[key.toLowerCase()] = map[key];
  }
  return out;
}

/** Traits for a Data Dragon id, against an index from `indexTraits`. */
export function traitsFor(
  index: Record<string, ChampionTraits>,
  id: string | undefined
): ChampionTraits | undefined {
  return id ? index[id.toLowerCase()] : undefined;
}

/**
 * Picks are stored as "Champion - note" lines, so setting a champion must not
 * throw away a note someone wrote against that slot.
 */
export function setChampionInLine(line: string | undefined, champion: string): string {
  const note = noteOf(line ?? '');
  return note ? `${champion} - ${note}` : champion;
}

export function championOf(line: string | undefined): string {
  const [champ] = (line ?? '').split(' - ');
  return (champ ?? '').trim();
}

export function noteOf(line: string | undefined): string {
  const parts = (line ?? '').split(' - ');
  return parts.slice(1).join(' - ').trim();
}

/**
 * Where focus goes after filling a slot: the next empty one, wrapping round.
 *
 * Wrapping matters more than it sounds. Filling top-to-bottom and stopping at
 * the end means someone who starts mid-comp has to click back up; wrapping
 * lets five picks be five clicks from any starting point.
 */
export function nextEmptySlot(picks: CompPicks, from: Role): Role | null {
  const order = ROLES;
  const start = order.indexOf(from);
  for (let step = 1; step <= order.length; step += 1) {
    const role = order[(start + step) % order.length];
    if (!championOf(picks[role])) return role;
  }
  return null;
}

/** Champions already in this comp, so the grid can grey them out. */
export function championsInComp(picks: CompPicks): Set<string> {
  const taken = new Set<string>();
  for (const role of ROLES) {
    const champ = championOf(picks[role]);
    if (champ) taken.add(champ.toLowerCase());
  }
  return taken;
}

/**
 * The grid, filtered by what was typed and which class chip is active.
 *
 * Search matches anywhere in the name rather than only the start, so "fortune"
 * finds Miss Fortune — the thing people actually type. Punctuation is ignored
 * on both sides so "kaisa" finds Kai'Sa.
 */
export function filterChampions(
  champions: readonly ChampionInfo[],
  query: string,
  tag: string | null
): ChampionInfo[] {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  return champions.filter((champ) => {
    if (tag && !champ.tags.includes(tag)) return false;
    if (!q) return true;
    return champ.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q);
  });
}
