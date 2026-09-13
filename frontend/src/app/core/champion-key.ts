/**
 * One key for a champion however it is spelled (13 Sep 2026, moved out of the champion picker for the
 * Roster poster). Game rows carry Riot's ids ("MissFortune", "MonkeyKing") and the roster's pools carry
 * display names ("Miss Fortune", "Wukong"); letters and digits in lower case settle most of them, and
 * the few champions whose id is another word entirely are aliased.
 */

/** Letters and digits only, lower case — the same key the champion data uses. */
export function championKey(value: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Riot ids that are not the display name with its punctuation dropped. */
const ID_ALIASES: Record<string, string> = {
  monkeyking: 'wukong',
  nunu: 'nunuwillump',
  renata: 'renataglasc'
};

function canonical(value: string): string {
  const key = championKey(value);
  return ID_ALIASES[key] ?? key;
}

/** The same champion, whether one side is Riot's id and the other the display name. */
export function sameChampion(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ka = canonical(a);
  return !!ka && ka === canonical(b);
}
