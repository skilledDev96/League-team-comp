/**
 * What a set of five champions adds up to.
 *
 * Rule-based on purpose. Aggregate win-rate data can tell you *whether* a comp
 * wins; it cannot tell you the comp is a poke comp, or that it has no
 * frontline. That reading is the thing a coach gives you and the stats tools
 * openly leave out, and it needs no data licence to compute.
 *
 * Lives on the client because it is a display concern — it runs as you click a
 * comp together, before anything is saved.
 */

import { ChampionTraits } from '../models/team.models';

/** How a comp's damage splits, and whether that split is a problem. */
export interface DamageProfile {
  physical: number;
  magic: number;
  mixed: number;
  /**
   * True when the comp is so one-sided that a single defensive item line
   * answers it — the classic all-AD comp beaten by armour stacking.
   */
  lopsided: boolean;
}

/** Four or more of five on one damage type is trivially itemised against. */
const LOPSIDED_AT = 4;

export function damageProfile(traits: ChampionTraits[]): DamageProfile {
  const profile = { physical: 0, magic: 0, mixed: 0, lopsided: false };
  for (const t of traits) {
    if (t.damage === 'physical') profile.physical += 1;
    else if (t.damage === 'magic') profile.magic += 1;
    else if (t.damage === 'mixed') profile.mixed += 1;
  }
  // Mixed champions count toward neither side, so they cannot mask a comp that
  // is otherwise entirely one type.
  profile.lopsided =
    traits.length >= 5 && (profile.physical >= LOPSIDED_AT || profile.magic >= LOPSIDED_AT);
  return profile;
}

export type CompIdentity =
  | 'poke'
  | 'dive'
  | 'teamfight'
  | 'pick'
  | 'split'
  | 'protect'
  | 'unclear';

/**
 * The comp's shape, from the traits of its five champions.
 *
 * Deliberately ordered: the checks run from most distinctive to least, and the
 * first that fits wins. A comp that is both mobile and heavy on crowd control
 * is a dive comp, not a teamfight comp, because that is how it will actually be
 * played.
 *
 * Returns `unclear` rather than guessing on a partial comp. A label on three
 * champions would be read as a finding when it is a coin flip.
 */
export function classifyComp(traits: ChampionTraits[]): CompIdentity {
  if (traits.length < 5) return 'unclear';

  const ranged = traits.filter((t) => t.attack === 'ranged').length;
  const totalCc = traits.reduce((sum, t) => sum + t.cc, 0);
  const totalMobility = traits.reduce((sum, t) => sum + t.mobility, 0);
  const frontline = traits.filter((t) => t.durability >= 2).length;
  const utility = traits.reduce((sum, t) => sum + t.utility, 0);
  const has = (role: string) => traits.some((t) => t.roles.includes(role));

  // Four or five ranged with little frontline: the comp wins by not being
  // reached, which is poke whatever else it can do.
  if (ranged >= 4 && frontline <= 1) return 'poke';

  // High mobility and enough crowd control to hold what it jumps on.
  if (totalMobility >= 10 && totalCc >= 8) return 'dive';

  // Assassins with burst and a way to catch: kills a target before a fight.
  if (has('assassin') && totalCc >= 6 && totalMobility >= 8) return 'pick';

  // Layered crowd control with bodies in front of it.
  if (totalCc >= 10 && frontline >= 2) return 'teamfight';

  // Enchanters and a carry to keep alive.
  if (utility >= 6 && has('marksman') && frontline >= 1) return 'protect';

  // A self-sufficient duelist and not much grouping.
  if (has('fighter') && totalCc <= 6 && frontline >= 1) return 'split';

  return 'unclear';
}

export const IDENTITY_LABEL: Record<CompIdentity, string> = {
  poke: 'Poke / siege',
  dive: 'Dive',
  teamfight: 'Teamfight',
  pick: 'Pick',
  split: 'Split push',
  protect: 'Protect the carry',
  unclear: 'No clear identity'
};

/**
 * A glyph per comp shape, so a comp can be recognised without reading its name.
 *
 * Material Symbols, which the app already loads — not emoji, which render as a
 * different picture on every platform and would not sit on the text baseline.
 * These are deliberately about *how the comp is played* rather than decoration:
 * the icon comes from `classifyComp`, so a comp nobody has named still gets a
 * meaningful one, and two comps that play alike look alike.
 *
 * `unclear` gets a deliberately neutral mark rather than a guess. On a comp of
 * three champions the classifier abstains, and the icon has to abstain with it.
 */
export const IDENTITY_ICON: Record<CompIdentity, string> = {
  poke: 'my_location',
  dive: 'flight_land',
  teamfight: 'groups',
  pick: 'trap',
  split: 'call_split',
  protect: 'shield_person',
  unclear: 'help'
};
