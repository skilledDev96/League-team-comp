import { OpponentPlayer, Role, TournamentSeries } from '../../models/team.models';
import { poolFor, starters } from '../../core/opponent-view';
import { Lane, LaneVerdict, readLanes, SeatInput } from './lane-read';

/**
 * What the draft room may say about the other team when it asks the advisor.
 *
 * Since 26 Sep 2026 the other team goes to the model as champions in seats and
 * nothing else: that is how the production-key ticket to Riot of that day
 * (App 876788) described `draftAdvice`, and the code was made to match it. No
 * Riot ID or game name, no rank, no per-champion record, no counters, no
 * mastery, no team name. The function strips all of those on the server
 * whatever arrives (`api/src/draft-advice.ts`); this file is the part only the
 * browser can do, and `advisorRequestParts` is the one place the draft room
 * builds every part of the request that could carry the other team, so a spec
 * can hold it to that.
 */

/** What the other side is called wherever its name would have been. */
export const OTHER_TEAM = 'the other team';

/** How much of the notes the advisor reads; the server cuts at the same length. */
export const ADVISOR_NOTES_MAX = 1500;

/** "their Jungle", or a plain phrase for a row whose seat is not set. */
export function theirSeatLabel(role: Role | '' | undefined): string {
  return role ? `their ${role}` : 'one of their players';
}

/** Their five as the advisor gets them: the seat and the champions it plays, most played first. */
export function advisorTheirRoster(players: readonly OpponentPlayer[]): { role: Role; pool: string[] }[] {
  return players.map((p) => ({ role: p.role, pool: poolFor(p).map((r) => r.champion) }));
}

/**
 * The champions their starters play, for a ban step's candidates: each seat's pool, then what each has touched in
 * the last two months (`recentChampions`, from mastery). Bare names, in that order. **Not** the champions that have
 * beaten them (`countersFor`): until 26 Sep 2026 those were ban candidates too, but they are read off one player's
 * own losses.
 */
export function opponentBanPool(players: readonly OpponentPlayer[]): string[] {
  return players.flatMap((p) => [...poolFor(p).map((r) => r.champion), ...(p.recentChampions ?? [])]);
}

/** One lane as the advisor reads it. */
export interface AdvisorLane {
  lane: Lane;
  verdict: LaneVerdict;
  score: number;
  reasons: string[];
}

/**
 * The lane read the advisor gets: read again with each seat's `theirComfort` taken out, because "Aatrox is a main
 * for them (12 games, 58%)" is one player's own record and its points sit in the score and the verdict as well as
 * the sentence — dropping the sentence alone would not do. Lanes with nothing to say are left out, and each keeps
 * its three largest reasons. The panel keeps the full read; this is only what leaves.
 */
export function advisorLanes(seats: readonly SeatInput[]): AdvisorLane[] {
  return readLanes(seats.map((s) => ({ ...s, theirComfort: undefined })))
    .filter((r) => r.verdict !== 'unknown')
    .map((r) => ({ lane: r.lane, verdict: r.verdict, score: r.score, reasons: r.reasons.slice(0, 3) }));
}

/** Letters and digits in any script: what a name boundary is measured against. Not `_`, so "Zzq_smurf" is found. */
const WORD_CHAR = '[\\p{L}\\p{N}]';
/** A Riot tag after a name, "#EUW" or " #EUW", swallowed with it so no "their Top#EUW" is left behind. */
const TAG = '(?:\\s?#\\s?[\\p{L}\\p{N}]{2,5})?';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** What a link becomes in the team's text. */
export const LINK_LABEL = '[link]';
/** What a written rank becomes in the team's text. */
export const RANK_LABEL = '[rank]';

/**
 * A link: anything after `http(s)://` or `www.`, or a bare host on a stat-site top-level domain with a path
 * ("op.gg/summoners/euw/Name-TAG", "u.gg/lol/profile/…", "leagueofgraphs.com/summoner/…"), up to the next space.
 */
const LINK = /(?:https?:\/\/|www\.)\S+|(?<![\p{L}\p{N}_.\-/@])(?:[\p{L}\p{N}-]+\.)+(?:gg|lol|com|net|org|io|app|co|me|tv|eu|de|fr|kr)\/\S*/giu;

/**
 * The team's text with every link replaced by `LINK_LABEL`. A roster arrives as an op.gg multi-search link
 * (`core/riot-id.ts`: the league rulebook requires one) and `core/note-lines.ts` renders links in the notes, so
 * pasting one there is expected — and inside a link a Riot ID is "MOSS+drakexo%23hwei%2C…", which no name pattern
 * matches. A link carries nothing the advisor can use. Closing punctuation stays outside, as `note-lines.ts` reads
 * it. Mirrors `stripLinks` in `api/src/draft-advice.ts`.
 */
export function stripLinks(text: string): string {
  return text.replace(LINK, (url) => {
    const tail = /[.,;:!?)\]}'"]+$/u.exec(url)?.[0] ?? '';
    return LINK_LABEL + tail;
  });
}

/** Every letter either case, without the `i` flag, so a division's capital I is never read as a pronoun. */
const anyCase = (word: string) => word.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Plat', 'Emerald', 'Diamond'].map(anyCase).join('|');
const APEX = ['Grandmaster', 'Master', 'Challenger'].map(anyCase).join('|');
const DIVISION = '(?:IV|III|II|I|[1-4])';
const LP = '\\d{1,4}\\s?[lL][pP]';
/**
 * A rank as people write one: a tier with a division ("Emerald II", "plat 4", "Diamond 1 (75 LP)"), any tier with LP
 * ("Master 212 LP"), or LP alone ("450LP"). A tier word alone is left, since "gold" and "Master Yi" are the game's
 * own words. Mirrors `api/src/draft-advice.ts`.
 */
const RANK = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(?:${TIERS})\\s?${DIVISION}(?:\\s?\\(?${LP}\\)?)?|(?:${TIERS}|${APEX})\\s?\\(?${LP}\\)?|${LP})(?![\\p{L}\\p{N}])`,
  'gu'
);

/** The team's text with every written rank replaced by `RANK_LABEL`. The ticket to Riot says no ranks. */
export function stripRanks(text: string): string {
  return text.replace(RANK, RANK_LABEL);
}

/**
 * The team's text with every opponent name replaced by the seat that player
 * holds ("their Jungle") and the team's name by `OTHER_TEAM`.
 *
 * **Client-side by necessity.** The notes are the team's own prep text and are
 * sent, but they may name the other side's players or quote their Riot IDs —
 * and the server never receives those names (it keeps only seats and pools),
 * so it cannot know what to look for. Only the browser holds the roster.
 *
 * Every player on their roster counts, the bench too, since a note can name a
 * sub. Case-insensitive and whole-word (measured in any script, so a name in
 * Hangul or with accents is bounded like one in Latin letters, and "Ren" never
 * bites into "Renekton"). A name matches with or without its spaces ("Hide on
 * bush", "hideonbush") and takes any Riot tag after it, so "Name#TAG" goes as
 * one. Longest first, in one pass, so a label written in is never matched
 * again. A term under two characters is skipped: no Riot name is that short,
 * and one letter would eat ordinary words. Only the names as stored are found:
 * a nickname, a misspelling or a stored "hideonbush" written "Hide on bush" is
 * not. Mirrored by `redactTerms` in `api/src/draft-advice.ts`, which only ever
 * meets names from a stale tab.
 */
export function redactOpponentNames(
  text: string,
  players: readonly Pick<OpponentPlayer, 'name' | 'riotTag' | 'role'>[],
  teamName?: string
): string {
  const terms: { term: string; label: string }[] = [];
  for (const p of players) {
    const label = theirSeatLabel(p.role);
    // A hand-typed row can hold the whole Riot ID in `name`; the game name alone must go too.
    const [gameName, inlineTag = ''] = (p.name ?? '').split('#');
    const name = gameName.trim();
    const tag = ((p.riotTag ?? '').trim() || inlineTag.trim()).replace(/^#/, '');
    if (name && tag) terms.push({ term: `${name}#${tag}`, label });
    if (name) terms.push({ term: name, label });
  }
  if (teamName?.trim()) terms.push({ term: teamName.trim(), label: OTHER_TEAM });

  const usable = terms.filter((t) => t.term.length >= 2).sort((a, b) => b.term.length - a.term.length);
  if (!text || !usable.length) return text;
  const alternatives = usable.map((t) => `(${t.term.split(/\s+/).map(escapeRegExp).join('\\s*')}${TAG})`);
  const pattern = new RegExp(`(?<!${WORD_CHAR})(?:${alternatives.join('|')})(?!${WORD_CHAR})`, 'giu');
  return text.replace(pattern, (...args: unknown[]) => {
    const hit = args.slice(1, 1 + usable.length).findIndex((g) => typeof g === 'string');
    return hit >= 0 ? usable[hit].label : String(args[0]);
  });
}

/**
 * Everything done to text the team wrote before the advisor reads it (the notes, a comp's name): links first, so a
 * Riot ID inside one goes whole; then every name on their roster and the team's name; then written ranks. A scrub,
 * not a guarantee — a record, a nickname or a description typed into the notes goes as typed, and
 * `docs/ai-provider-note.md` says so. Mirrors `scrubTeamText` in `api/src/draft-advice.ts`.
 */
export function scrubTeamText(
  text: string,
  players: readonly Pick<OpponentPlayer, 'name' | 'riotTag' | 'role'>[],
  teamName?: string
): string {
  return text ? stripRanks(redactOpponentNames(stripLinks(text), players, teamName)) : text;
}

/** The series as the draft room holds it, for what it says about the other side. */
export type AdvisorSeries = Pick<TournamentSeries, 'opponent' | 'opponentPlayers' | 'notes'>;

/** Every part of the advisor's request that could carry the other team. */
export interface AdvisorRequestParts<C extends { name: string }> {
  /** Their starters as seats and champions. */
  theirRoster: { role: Role; pool: string[] }[];
  /** The champions their starters play, for a ban step's candidates. */
  banCandidates: string[];
  /** The lane read without their players' comfort. */
  lanes: AdvisorLane[];
  /** Tells the server the lanes were read that way; a request without it has its lanes dropped. */
  lanesWithoutTheirComfort: true;
  /** Our comps, each name scrubbed like the notes, since a comp can be named after one of theirs. */
  comps: C[];
  /** The team's notes, scrubbed, then cut to `ADVISOR_NOTES_MAX`; absent when nothing is left. */
  notes?: string;
}

/**
 * The parts of the advisor's request that could carry the other team, built in one place (26 Sep 2026): their
 * roster as seats and champions, the ban candidates their pools give, the lane read without their comfort, and every
 * piece of text the team wrote (the notes and the comp names) scrubbed of links, ranks and every name on their
 * roster — the bench too, since a note can name a sub — and the team's name. Scrubbed before it is cut, so a name or
 * a link straddling the cut is not left half-there. There is no team name among the parts: the request does not
 * carry one, and the prompt says "the other team".
 */
export function advisorRequestParts<C extends { name: string }>(input: {
  series: AdvisorSeries | null | undefined;
  seats: readonly SeatInput[];
  comps: readonly C[];
}): AdvisorRequestParts<C> {
  const everyone = input.series?.opponentPlayers ?? [];
  const theirs = starters(everyone);
  const scrub = (text: string) => scrubTeamText(text, everyone, input.series?.opponent);
  const notes = scrub(input.series?.notes ?? '').trim().slice(0, ADVISOR_NOTES_MAX);
  return {
    theirRoster: advisorTheirRoster(theirs),
    banCandidates: opponentBanPool(theirs),
    lanes: advisorLanes(input.seats),
    lanesWithoutTheirComfort: true,
    comps: input.comps.map((c) => ({ ...c, name: scrub(c.name) })),
    ...(notes ? { notes } : {})
  };
}
