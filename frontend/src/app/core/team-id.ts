import { isTeamId } from './team-scope';

/**
 * How a new team gets its id (27 Sep 2026, release 2, Stage 3): the name slugged, a hyphen, and six
 * random lower-case alphanumerics, so "Bom Squad Academy" becomes `bom-squad-academy-k3x9qa`. The
 * slug is for a person reading a path or the Firestore console; the suffix is what keeps two teams
 * named alike apart, and what lets a deleted team's name be reused without its old prefix coming back.
 *
 * Pure, with the random source injected, so the spec can force a collision and read the result.
 * Nothing here touches Firestore: `TeamDataService.createTeam` writes the document.
 */

/** The alphabet of the suffix: what `isTeamId` allows minus the hyphen, so the suffix reads as one word. */
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const SUFFIX_LENGTH = 6;
/** `isTeamId` allows 40 characters; the slug gets what is left after the hyphen and the suffix. */
const SLUG_MAX = 40 - 1 - SUFFIX_LENGTH;
/** How many suffixes to try against a collision before giving up; 36^6 ids makes even two a surprise. */
const ATTEMPTS = 20;

/**
 * A team's name as a slug: lower-case letters, digits and hyphens, runs of anything else collapsed
 * to one hyphen, none at either end. Accents are folded first (NFKD splits "é" into "e" and a
 * combining mark, which is then dropped), so "Équipe Ünïcode" reads `equipe-unicode`; a name with
 * nothing Latin in it slugs to the empty string, which `newTeamId` refuses. Cut to what fits beside
 * the suffix, without leaving a hyphen at the cut.
 */
export function slugTeamName(name: string): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

/**
 * Six characters from the suffix alphabet, from the browser's random source. Falls back to
 * Math.random only where `crypto` is missing, which no supported browser is.
 */
export function randomSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_LENGTH);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (const b of bytes) out += SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length];
  return out;
}

/**
 * The id for a team called `name`, not among `existing`. Throws when the name slugs to nothing (a
 * team needs a readable prefix) and when the random source keeps colliding or answering something
 * that is not a suffix, so a bad id can never build a path: every answer satisfies `isTeamId`.
 */
export function newTeamId(name: string, existing: readonly string[], random: () => string = randomSuffix): string {
  const slug = slugTeamName(name);
  if (!slug) throw new Error('The team name needs at least one letter or digit.');
  const taken = new Set(existing);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const suffix = random();
    if (suffix.length !== SUFFIX_LENGTH || [...suffix].some((ch) => !SUFFIX_ALPHABET.includes(ch))) {
      throw new Error(`Not a team id suffix: ${JSON.stringify(suffix)}`);
    }
    const id = `${slug}-${suffix}`;
    if (!isTeamId(id)) throw new Error(`Not a team id: ${JSON.stringify(id)}`);
    if (!taken.has(id)) return id;
  }
  throw new Error(`Could not find a free id for ${JSON.stringify(name)} in ${ATTEMPTS} tries.`);
}
