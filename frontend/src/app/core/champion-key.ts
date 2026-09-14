/**
 * One key for a champion however it is spelled (13 Sep 2026, moved out of the champion picker for the
 * Roster poster). Game rows carry Riot's ids ("MissFortune", "MonkeyKing") and the roster's pools carry
 * display names ("Miss Fortune", "Wukong"); letters and digits in lower case settle most of them, and
 * the few champions whose id is another word entirely are aliased.
 *
 * Since 14 Sep 2026 every per-champion count keys on `canonicalChampion`: a replay stores Riot's id
 * ("TahmKench", "JarvanIV", "Kaisa") while a Riot row stores the display name, and a pool keyed by the
 * raw string counted one champion as two ("Tahm Kench 69% 13" beside "Tahm Kench 0% 3").
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

/** The display name, for the champions whose Riot id differs from it by capitals alone. */
const DISPLAY_BY_KEY: Record<string, string> = {
  leblanc: 'LeBlanc',
  fiddlesticks: 'Fiddlesticks'
};

/** The one key a champion counts under, whichever spelling arrived: "MonkeyKing" and "Wukong" are both "wukong". */
export function canonicalChampion(value: string): string {
  const key = championKey(value);
  return ID_ALIASES[key] ?? key;
}

/** The same champion, whether one side is Riot's id and the other the display name. */
export function sameChampion(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ka = canonicalChampion(a);
  return !!ka && ka === canonicalChampion(b);
}

/** How much a spelling reads like the name on screen: the known display, then not an alias id, then its punctuation. */
function displayRank(spelling: string): number {
  const key = championKey(spelling);
  const canon = ID_ALIASES[key] ?? key;
  if (DISPLAY_BY_KEY[canon] === spelling) return 1000;
  return (ID_ALIASES[key] ? 0 : 100) + (spelling.match(/[^A-Za-z0-9]/g)?.length ?? 0);
}

/**
 * Of two spellings of one champion, the one to show: "Tahm Kench" over "TahmKench", "Wukong" over
 * "MonkeyKing", "Kai'Sa" over "Kaisa". Only ever one of the two it is given, so an icon lookup that
 * resolves the spelling it was handed keeps working; a tie keeps the first.
 */
export function displaySpelling(current: string, other: string): string {
  return displayRank(other) > displayRank(current) ? other : current;
}
