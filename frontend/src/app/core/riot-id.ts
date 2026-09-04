/**
 * Reading Riot IDs out of whatever someone pasted.
 *
 * Opponent rosters arrive as op.gg multi-search links, because the league
 * rulebook requires every team to publish one. That link is the fastest way to
 * get five Riot IDs into this app — but **only the text of the URL is read**.
 * The site is never requested. Riot's General Policies forbid scraping "any
 * other sources outside of the provided Riot API Endpoints", with indefinite
 * revocation of API access as the stated penalty, and a fetch to op.gg would be
 * exactly that. Everything here is string handling on something a person typed.
 */

export interface RiotId {
  /** The part before the hash — Riot calls it the game name. */
  readonly name: string;
  /** The part after it, without the hash. */
  readonly tag: string;
  /** Platform hint when the link carried one, e.g. "euw". */
  readonly region?: string;
}

/** Regions op.gg puts in a path, mapped to what the enrichment endpoint wants. */
const REGION_ALIASES: Record<string, string> = {
  euw: 'euw',
  eune: 'eune',
  na: 'na',
  kr: 'kr',
  br: 'br',
  jp: 'jp',
  lan: 'lan',
  las: 'las',
  oce: 'oce',
  ru: 'ru',
  tr: 'tr'
};

function clean(value: string): string {
  // A query string encodes a space as "+", so "MOSS+drakexo" is two words and
  // not a name with a plus in it. decodeURIComponent does not do this — it is a
  // rule of the query format, not of percent-encoding — so it happens here or
  // every scouted name comes out wrong. %23 is a hash that survived a copy from
  // an address bar.
  return decodeURIComponent(value.trim().replace(/\+/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The tagline a region hands out by default.
 *
 * op.gg leaves the tag off a multi-search entry when it is the region's
 * default, so a five-player link routinely arrives with two names bare. Read
 * as "no tag", those two vanished and a five-stack came through as three —
 * which is how it looked on the first real link pasted.
 */
const DEFAULT_TAG: Record<string, string> = {
  euw: 'EUW',
  eune: 'EUNE',
  na: 'NA1',
  kr: 'KR',
  br: 'BR1',
  jp: 'JP1',
  lan: 'LAN',
  las: 'LAS',
  oce: 'OCE',
  ru: 'RU',
  tr: 'TR1'
};

function toId(raw: string, region?: string): RiotId | null {
  const text = clean(raw);
  if (!text) return null;

  const hash = text.lastIndexOf('#');
  if (hash > 0) {
    const name = text.slice(0, hash).trim();
    const tag = text.slice(hash + 1).trim();
    if (name && tag) return { name, tag, region };
    return null;
  }

  // No tag. Safe to fill in only when the region is known — from a link —
  // because that is the one case where a missing tag has a definite meaning.
  // A bare name typed by hand still needs its tag: guessing there could scout
  // a stranger on another region, which is worse than an empty row.
  if (region && DEFAULT_TAG[region]) return { name: text, tag: DEFAULT_TAG[region], region };
  return null;
}

/**
 * Every Riot ID in a blob of text.
 *
 * Handles the three shapes a person actually produces: a multi-search link, a
 * single summoner link, and IDs typed or pasted as a list. Anything it cannot
 * read is skipped rather than guessed at — a wrong Riot ID scouts a stranger,
 * which is worse than an empty row.
 */
export function parseRiotIds(input: string): RiotId[] {
  const text = (input ?? '').trim();
  if (!text) return [];

  const found: RiotId[] = [];
  const seen = new Set<string>();
  const add = (id: RiotId | null) => {
    if (!id) return;
    const key = `${id.name}#${id.tag}`.toLowerCase();
    if (seen.has(key)) return; // A roster does not contain the same player twice.
    seen.add(key);
    found.push(id);
  };

  // op.gg multi-search: .../multisearch/euw?summoners=A%23EUW,B%23EUW
  const multi = text.match(/multisearch\/([a-z]+)\?summoners=([^\s&]+)/i);
  if (multi) {
    const region = REGION_ALIASES[multi[1].toLowerCase()];
    for (const part of decodeURIComponent(multi[2]).split(',')) add(toId(part, region));
    if (found.length) return found;
  }

  // op.gg summoner pages: .../summoners/euw/Name-TAG
  const singles = [...text.matchAll(/summoners?\/([a-z]+)\/([^/\s?#]+)/gi)];
  for (const hit of singles) {
    const region = REGION_ALIASES[hit[1].toLowerCase()];
    // The path separates name and tag with a dash rather than a hash.
    const slug = decodeURIComponent(hit[2]);
    const dash = slug.lastIndexOf('-');
    if (dash > 0) add(toId(`${slug.slice(0, dash)}#${slug.slice(dash + 1)}`, region));
  }
  if (found.length) return found;

  // Plain IDs, however they were separated.
  for (const part of text.split(/[\n,;]+/)) add(toId(part));
  return found;
}

/** The first Riot ID in some text, for a single-player field. */
export function parseRiotId(input: string): RiotId | null {
  return parseRiotIds(input)[0] ?? null;
}

/** Back to the form a person reads, for display and for storage. */
export function formatRiotId(id: RiotId): string {
  return `${id.name}#${id.tag}`;
}
