/**
 * The draft advisor: what goes to the model and what comes back.
 *
 * The draft room already knows a great deal — our comps and their record,
 * the champions each of their seats plays, the lane matchup rates, the lane
 * read — and shows each in its own panel. What it
 * could not do was weigh them against each other with the clock running.
 * That is what a model is for: read everything at once and say, in a few
 * lines, what to take and why.
 *
 * The model only ranks; it never invents. Every champion it may name is in
 * the candidate list the app sends, which is already filtered for the burn,
 * the bans and the seat, and `parseAdvice` drops anything outside it. The
 * data is the app's own and stored, so nothing new is fetched to answer.
 *
 * **The other team goes to the model as champions in seats, and nothing
 * else** (26 Sep 2026). That is how the production-key ticket to Riot of that
 * day (App 876788) described this function, and the code was made to match
 * it rather than the other way round: no Riot ID or game name, no rank, no
 * per-champion record, no counters, no mastery and no team name. The server
 * is the guard, not the draft room — a tab open across a deploy still sends
 * the old fields — so `parseDraftAdviceRequest` keeps only each opponent's
 * seat and champion pool whatever arrives, drops the lane read unless the
 * request says it was read without their players' comfort, replaces every
 * link and every written rank in the team's own text (the notes and the comp
 * names), and uses any names that do arrive to redact that text before
 * discarding them. Our own players are still named: that is disclosed.
 *
 * The team's text is free text, so this is a scrub, not a guarantee: only a
 * link, a rank written as a tier with a division or LP, and the exact stored
 * names are caught. A record, a nickname or a misspelling typed into the notes
 * goes as typed, and `docs/ai-provider-note.md` says so.
 *
 * Pure here: request validation, prompt text, output schema, answer
 * validation. The call itself is in index.ts beside the other handlers.
 */

export type KnownRole = 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';

export interface AdviceRoster {
  name: string;
  role: KnownRole;
  /** Most played first. */
  pool: string[];
}

/**
 * One seat of the other team: the seat and the champions it plays, most played
 * first. No name, rank, record, counter or mastery — see the file comment.
 */
export interface AdviceOpponent {
  role: KnownRole;
  pool: string[];
}

export interface AdviceComp {
  name: string;
  champions: string[];
  winRate?: number;
  games?: number;
  playable: boolean;
  /** Which of its champions are gone this game. */
  blocked: string[];
}

export interface AdviceLane {
  lane: string;
  verdict: string;
  score: number;
  reasons: string[];
}

export interface DraftAdviceRequest {
  /** Ours. The other team has no name here: the prompt calls it `OTHER_TEAM`. */
  teamName: string;
  /** What the sequence is asking for right now. */
  action: 'ban' | 'pick';
  /** Whose turn; `their` means we are advising on what to expect and ban. */
  turn: 'our' | 'their';
  stepNumber: number;
  ourSide: 'blue' | 'red' | null;
  /** The seat the next pick lands in, when it is ours. */
  seat: KnownRole | null;
  ourPicks: Partial<Record<KnownRole, string>>;
  theirPicks: Partial<Record<KnownRole, string>>;
  bans: string[];
  burned: string[];
  ourRoster: AdviceRoster[];
  theirRoster: AdviceOpponent[];
  /** Ours; each name scrubbed like the notes, since a comp can be named after one of theirs. */
  comps: AdviceComp[];
  /**
   * Lane reads, only from a draft room that read them without their players' comfort
   * (`lanesWithoutTheirComfort`); any other request's lanes are dropped whole.
   */
  lanes: AdviceLane[];
  /** Champions the model may name. Already legal for this step. */
  candidates: string[];
  /** Solo queue win rate at large, where known, keyed by champion. */
  soloRates: Record<string, number>;
  /** Our candidate into their champion in the seat, where the sample allows. */
  matchups: { ours: string; theirs: string; winRate: number; games: number }[];
  /**
   * The team's own notes for the series, trimmed: links and written ranks replaced, and any opponent name that
   * arrived replaced by its seat (`scrubTeamText`).
   */
  notes?: string;
}

export interface DraftAdvice {
  summary: string;
  picks: { champion: string; seat: KnownRole | null; why: string; confidence: 'high' | 'medium' | 'low' }[];
  bans: { champion: string; why: string }[];
  /** What to watch for in their next moves. */
  watch: string[];
}

const MAX_CANDIDATES = 80;
const MAX_NOTES = 1500;
const ROLES: KnownRole[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

/** What the prompt calls the other side, in place of its name. */
export const OTHER_TEAM = 'the other team';

/**
 * The lane reasons `readSeat` (frontend `pages/tournaments/lane-read.ts`) words
 * from an opponent player's own games on their champion: "Aatrox is a main for
 * them (12 games, 58%)", "is in their pool", "is not in their player's recent
 * pool". A second belt only: a request without `lanesWithoutTheirComfort` loses
 * every lane anyway, because the stale draft room sent only the first three
 * reasons of a lane, so the comfort sentence was often cut while its points
 * stayed in the score and the verdict, and no sentence test can see that.
 */
const OPPONENT_COMFORT_REASON = /\b(?:is a main for them|is in their pool|is not in their player's recent pool)\b/i;

/**
 * Letters and digits in any script: what a name boundary is measured against. Not `_`, so a name
 * written into a handle ("Zzq_smurf") is still found.
 */
const WORD_CHAR = '[\\p{L}\\p{N}]';

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
 * (`frontend/src/app/core/riot-id.ts`: the league rulebook requires one) and the notes render links, so pasting it
 * into the notes is expected — and inside a link a Riot ID is "MOSS+drakexo%23hwei%2C…", which no name pattern
 * matches. A link carries nothing the advisor can use. Closing punctuation stays outside, as `note-lines.ts` reads it.
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
 * own words.
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
 * Replace each term, whole-word and case-insensitive, with its label. A name
 * matches with or without its spaces ("Hide on bush", "hideonbush") and takes
 * a trailing Riot tag with it ("Name#EUW", "Name #EUW"), so a Riot ID never
 * survives as "their Top#EUW". Longest term first, in one pass, so a label
 * written in is never matched again. Terms under two characters are skipped:
 * no Riot name is that short, and one letter would eat ordinary words.
 *
 * Mirrors `redactOpponentNames` in `frontend/src/app/pages/tournaments/advisor-request.ts`,
 * which does this before the request leaves the browser (the server never
 * receives the names, so only the browser can); this copy only ever sees names
 * from a stale tab that still sends them.
 */
export function redactTerms(text: string, terms: readonly { term: string; label: string }[]): string {
  const usable = terms
    .map((t) => ({ term: t.term.trim(), label: t.label }))
    .filter((t) => t.term.length >= 2)
    .sort((a, b) => b.term.length - a.term.length);
  if (!text || !usable.length) return text;
  const tag = '(?:\\s?#\\s?[\\p{L}\\p{N}]{2,5})?';
  const alternatives = usable.map((t) => `(${t.term.split(/\s+/).map(escapeRegExp).join('\\s*')}${tag})`);
  const pattern = new RegExp(`(?<!${WORD_CHAR})(?:${alternatives.join('|')})(?!${WORD_CHAR})`, 'giu');
  return text.replace(pattern, (...args: unknown[]) => {
    const groups = args.slice(1, 1 + usable.length);
    const hit = groups.findIndex((g) => typeof g === 'string');
    return hit >= 0 ? usable[hit].label : String(args[0]);
  });
}

/**
 * Everything the server does to text the team wrote before the model reads it (the notes, a comp's name): links
 * first, so a Riot ID inside one goes whole; then the names a stale tab sent; then written ranks. Mirrors
 * `scrubTeamText` in `frontend/src/app/pages/tournaments/advisor-request.ts`. Only the links and the ranks can be
 * done here for a current tab, which sends no names; the browser does the names.
 */
export function scrubTeamText(text: string, terms: readonly { term: string; label: string }[]): string {
  return text ? stripRanks(redactTerms(stripLinks(text), terms)) : text;
}

/** "their Jungle", or a plain phrase for a row whose seat is unknown. */
function theirSeat(r: KnownRole | null): string {
  return r ? `their ${r}` : 'one of their players';
}

function str(v: unknown, max = 60): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strList(v: unknown, max = 40, each = 60): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : [];
}

function role(v: unknown): KnownRole | null {
  return typeof v === 'string' && (ROLES as string[]).includes(v) ? (v as KnownRole) : null;
}

function picks(v: unknown): Partial<Record<KnownRole, string>> {
  const out: Partial<Record<KnownRole, string>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const r of ROLES) {
    const champ = str((v as Record<string, unknown>)[r]);
    if (champ) out[r] = champ;
  }
  return out;
}

/** Reject anything that is not the shape the draft room sends. */
export function parseDraftAdviceRequest(body: unknown): DraftAdviceRequest {
  if (!body || typeof body !== 'object') throw new Error('Invalid payload. Expected a JSON object.');
  const b = body as Record<string, unknown>;

  const action = b.action === 'ban' || b.action === 'pick' ? b.action : null;
  if (!action) throw new Error('action must be "ban" or "pick".');
  const candidates = strList(b.candidates, MAX_CANDIDATES);
  if (!candidates.length) throw new Error('candidates must name at least one champion.');

  const rows = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {})) : [];

  // Ours: named. They are our own players, and that is disclosed.
  const ourRoster: AdviceRoster[] = rows(b.ourRoster)
    .map((row): AdviceRoster | null => {
      const r = role(row.role);
      return r ? { name: str(row.name, 40) || 'player', role: r, pool: strList(row.pool, 12) } : null;
    })
    .filter((x): x is AdviceRoster => !!x)
    .slice(0, 7);

  // Theirs: the seat and the champions, whatever else the row carries. A stale
  // tab still sends name, rank, records, counters and mastery; none of them is
  // read, and the names are used once, below, to clear them out of the notes and the comp names.
  const theirRows = rows(b.theirRoster);
  const theirRoster: AdviceOpponent[] = theirRows
    .map((row): AdviceOpponent | null => {
      const r = role(row.role);
      return r ? { role: r, pool: strList(row.pool, 12) } : null;
    })
    .filter((x): x is AdviceOpponent => !!x)
    .slice(0, 7);

  const nameTerms = [
    ...theirRows.flatMap((row) => {
      const label = theirSeat(role(row.role));
      // A hand-typed row can hold the whole Riot ID in `name`; the game name alone must go too.
      const [gameName, inlineTag = ''] = str(row.name, 60).split('#');
      const name = gameName.trim();
      const tag = (str(row.riotTag, 10) || inlineTag).trim().replace(/^#/, '');
      return [
        ...(name && tag ? [{ term: `${name}#${tag}`, label }] : []),
        ...(name ? [{ term: name, label }] : [])
      ];
    }),
    ...(str(b.opponent, 60) ? [{ term: str(b.opponent, 60), label: OTHER_TEAM }] : [])
  ];
  // Scrub before cutting to length, so a name or a link straddling the cut is never left half-there.
  const rawNotes = typeof b.notes === 'string' ? b.notes.slice(0, MAX_NOTES * 4) : '';
  const notes = scrubTeamText(rawNotes, nameTerms).trim().slice(0, MAX_NOTES);

  const comps: AdviceComp[] = Array.isArray(b.comps)
    ? b.comps
        .map((c): AdviceComp | null => {
          const row = (c ?? {}) as Record<string, unknown>;
          // Team-written like the notes: "Anti-Zzq" or "vs MAD Synergy" would name them.
          const name = scrubTeamText(str(row.name, 160), nameTerms).trim().slice(0, 40);
          if (!name) return null;
          const winRate = Number(row.winRate);
          const games = Number(row.games);
          return {
            name,
            champions: strList(row.champions, 5),
            winRate: Number.isFinite(winRate) ? Math.round(winRate) : undefined,
            games: Number.isFinite(games) ? Math.round(games) : undefined,
            playable: row.playable === true,
            blocked: strList(row.blocked, 5)
          };
        })
        .filter((x): x is AdviceComp => !!x)
        .slice(0, 20)
    : [];

  // Fail closed. Before 26 Sep 2026 the room read each lane with their players' comfort in it ("Aatrox is a main
  // for them (40 games, 55%)", worth 8 points) and sent only the first three reasons, sorted by size — so the
  // comfort sentence was often cut while its points stayed in the score and the verdict, and the text alone cannot
  // show it. A room that reads the lanes without it says so; every other request's lanes go whole.
  const lanesWithoutTheirs = b.lanesWithoutTheirComfort === true;
  const lanes: AdviceLane[] = lanesWithoutTheirs && Array.isArray(b.lanes)
    ? b.lanes
        .map((l): AdviceLane | null => {
          const row = (l ?? {}) as Record<string, unknown>;
          const lane = str(row.lane, 10);
          if (!lane) return null;
          // Second belt: a lane that still carries one of their players' comfort sentences goes whole.
          const reasons = Array.isArray(row.reasons) ? row.reasons : [];
          if (reasons.some((r) => typeof r === 'string' && OPPONENT_COMFORT_REASON.test(r))) return null;
          const score = Number(row.score);
          return {
            lane,
            verdict: str(row.verdict, 10) || 'unknown',
            score: Number.isFinite(score) ? Math.round(score) : 0,
            reasons: strList(reasons, 4, 160)
          };
        })
        .filter((x): x is AdviceLane => !!x)
        .slice(0, 4)
    : [];

  const soloRates: Record<string, number> = {};
  if (b.soloRates && typeof b.soloRates === 'object') {
    for (const [champ, rate] of Object.entries(b.soloRates as Record<string, unknown>)) {
      const n = Number(rate);
      if (champ && Number.isFinite(n)) soloRates[str(champ)] = Math.round(n);
    }
  }

  const matchups = Array.isArray(b.matchups)
    ? b.matchups
        .map((m) => {
          const row = (m ?? {}) as Record<string, unknown>;
          const ours = str(row.ours);
          const theirs = str(row.theirs);
          const winRate = Number(row.winRate);
          const games = Number(row.games);
          return ours && theirs && Number.isFinite(winRate) && Number.isFinite(games)
            ? { ours, theirs, winRate: Math.round(winRate), games: Math.round(games) }
            : null;
        })
        .filter((x): x is DraftAdviceRequest['matchups'][number] => !!x)
        .slice(0, MAX_CANDIDATES)
    : [];

  const stepNumber = Number(b.stepNumber);
  return {
    teamName: str(b.teamName, 40) || 'Us',
    action,
    turn: b.turn === 'their' ? 'their' : 'our',
    stepNumber: Number.isFinite(stepNumber) ? Math.max(1, Math.round(stepNumber)) : 1,
    ourSide: b.ourSide === 'blue' || b.ourSide === 'red' ? b.ourSide : null,
    seat: role(b.seat),
    ourPicks: picks(b.ourPicks),
    theirPicks: picks(b.theirPicks),
    bans: strList(b.bans, 10),
    burned: strList(b.burned, 40),
    ourRoster,
    theirRoster,
    comps,
    lanes,
    candidates,
    soloRates,
    matchups,
    notes: notes || undefined
  };
}

/**
 * Stable across calls, so it caches; nothing about this draft is in it.
 * The rules matter more than the persona: the model must stay inside the
 * candidate list, respect fearless, and say when a sample is too small.
 */
export const ADVISOR_SYSTEM = `You are the draft coach for an amateur League of Legends five-stack playing a fearless-draft best-of series. You are asked one question at a time, with the clock running, and answer in a few plain sentences a player can act on immediately.

Rules that never bend:
- Only name champions from the CANDIDATES list. Anything else is banned, burned, already picked, or does not fit the seat, and naming it wastes the turn.
- Under fearless draft, a champion used by either team earlier in the series is gone for the rest of it. Weigh a pick against what it costs later games too.
- Prefer champions the player in that seat actually plays. A strong champion nobody on the roster plays is not a pick.
- The other team is seats and champions, nothing more. Never name, rate or describe any individual player of theirs, and never guess who they are; refer to them only by seat and champion ("their Jungle", "their Aatrox"). Our own players may be named.
- Our own comp records are tens of games; solo queue and matchup rates are thousands. Say which you are leaning on, and say when a number is too thin to trust.
- The TEAM PLAN is the team's own intent, written before the draft. Lead with it: when the plan names a pick and it is still legal, it is your first answer. Deviate only when the board has made it a bad idea, and say so in the summary.
- Rank, do not list. Give at most three picks or three bans, best first, each with one sentence of reason that names the evidence.
- No hedging boilerplate, no headings, no markdown. The team can read; be direct.

Answer length, because the draft clock is thirty seconds and every word costs time:
- Answer only what was asked. For a pick question leave "bans" empty; for a ban question leave "picks" empty.
- "summary" is one sentence. Each "why" is one clause under 20 words that names the evidence.
- "watch" has at most two items, each under 12 words. Leave it empty if there is nothing worth watching.
- OUR PICKS and THEIR PICKS are the only record of what is locked. The TEAM PLAN is intent written before the draft: a champion it names is not ours until it appears in OUR PICKS, and a "core" is not set until every champion in it does. With OUR PICKS empty, the first pick is still to be made.
- When a ban or a burn matters, say it plainly: "with Renekton banned", "Udyr is burned". Never fold it into a compound word like "Renekton-less" — under the clock that reads as the opposite.`;

function pickLine(p: Partial<Record<KnownRole, string>>): string {
  return ROLES.map((r) => `${r}: ${p[r] ?? '—'}`).join(', ');
}

/** The draft as text the model reads once. */
export function buildDraftPrompt(req: DraftAdviceRequest): string {
  const lines: string[] = [];
  const asking =
    req.action === 'ban'
      ? req.turn === 'our'
        ? `We are banning (ban ${req.stepNumber}). Which champion should we ban, and why?`
        : `They are banning. What are they likely to take from us, and what should we be ready to pick after?`
      : req.turn === 'our'
        ? `We are picking${req.seat ? ` for ${req.seat}` : ''} (step ${req.stepNumber}). Which champion should we take, and why?`
        : `They are picking next. What should we expect, and what should we prepare to answer with?`;

  lines.push(`QUESTION: ${asking}`);
  if (req.action === 'pick' && req.turn === 'our' && !req.seat) {
    const open = ROLES.filter((r) => !req.ourPicks[r]);
    if (open.length) {
      lines.push(`SEATS STILL OPEN FOR US: ${open.join(', ')} — choose the seat as well as the champion, and set "seat" on each pick.`);
    }
  }
  lines.push('');
  if (req.notes) {
    lines.push(
      `TEAM PLAN (our own notes for this series, written before the draft; may be in Afrikaans; their players appear by seat, e.g. "their Jungle", and links and ranks as ${LINK_LABEL} and ${RANK_LABEL}):`
    );
    lines.push(req.notes);
    lines.push('');
  }

  lines.push(`SERIES: ${req.teamName} vs ${OTHER_TEAM}. We are on ${req.ourSide ?? 'an unknown'} side.`);
  const locked = ROLES.filter((r) => req.ourPicks[r]).length;
  lines.push(`OUR PICKS: ${pickLine(req.ourPicks)}${locked ? '' : ' (nothing locked yet — our board is empty)'}`);
  lines.push(`THEIR PICKS: ${pickLine(req.theirPicks)}`);
  lines.push(`BANS THIS GAME: ${req.bans.length ? req.bans.join(', ') : 'none yet'}`);
  lines.push(`BURNED EARLIER IN THE SERIES: ${req.burned.length ? req.burned.join(', ') : 'none — first game'}`);
  lines.push('');

  lines.push('OUR ROSTER (most played first):');
  for (const p of req.ourRoster) lines.push(`- ${p.role} ${p.name}: ${p.pool.join(', ') || 'unknown pool'}`);
  lines.push('');

  // Seats and champions only (26 Sep 2026): no name, rank, record, counter or mastery ever reaches this block.
  lines.push('THEIR ROSTER (by seat: the champions each seat plays, most played first):');
  if (!req.theirRoster.length) lines.push('- not scouted');
  for (const p of req.theirRoster) {
    lines.push(`- ${p.role}: ${p.pool.length ? `plays ${p.pool.join(', ')}` : 'pool not scouted'}`);
  }
  lines.push('');

  if (req.comps.length) {
    // A seat can hold fallbacks since 20 Sep 2026, so a comp is playable while every seat can still field
    // one of its champions — which means a playable comp may carry blocked champions, and BROKEN counts seats.
    lines.push('OUR COMPS (record from our own games; playable = every seat can still field one of its champions, so a playable comp may list blocked champions where a seat is on a fallback):');
    for (const c of req.comps) {
      const record = c.games ? `${c.winRate}% over ${c.games}` : 'no games yet';
      lines.push(
        `- ${c.name}: ${c.champions.join(', ')} — ${record}${c.playable ? (c.blocked.length ? `; on a fallback, ${c.blocked.join(', ')} gone` : '') : `; BROKEN, a seat has nothing left (${c.blocked.join(', ')} gone)`}`
      );
    }
    lines.push('');
  }

  if (req.lanes.length) {
    lines.push('LANE READ SO FAR (from matchup data, solo queue rates, our pools and traits):');
    for (const l of req.lanes) {
      lines.push(`- ${l.lane}: ${l.verdict} (${l.score > 0 ? '+' : ''}${l.score})${l.reasons.length ? ` — ${l.reasons.join('; ')}` : ''}`);
    }
    lines.push('');
  }

  if (req.matchups.length) {
    lines.push('MATCHUP RATES (our candidate into their champion in that seat, solo queue, this patch):');
    for (const m of req.matchups) lines.push(`- ${m.ours} into ${m.theirs}: ${m.winRate}% over ${m.games} games`);
    lines.push('');
  }

  const rated = Object.entries(req.soloRates);
  if (rated.length) {
    lines.push('SOLO QUEUE WIN RATES (champion at large, this patch):');
    lines.push(rated.map(([c, r]) => `${c} ${r}%`).join(', '));
    lines.push('');
  }


  lines.push(`CANDIDATES (the only champions you may name): ${req.candidates.join(', ')}`);
  return lines.join('\n');
}

/** What the model must return. Kept flat so a draft screen can render it as-is. */
export const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two sentences: the situation and the call.' },
    picks: {
      type: 'array',
      description: 'At most three, best first.',
      items: {
        type: 'object',
        properties: {
          champion: { type: 'string' },
          seat: { anyOf: [{ type: 'string', enum: [...ROLES] }, { type: 'null' }] },
          why: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['champion', 'seat', 'why', 'confidence'],
        additionalProperties: false
      }
    },
    bans: {
      type: 'array',
      description: 'At most three, best first.',
      items: {
        type: 'object',
        properties: { champion: { type: 'string' }, why: { type: 'string' } },
        required: ['champion', 'why'],
        additionalProperties: false
      }
    },
    watch: { type: 'array', description: 'At most three.', items: { type: 'string' } }
  },
  required: ['summary', 'picks', 'bans', 'watch'],
  additionalProperties: false
} as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The answer, checked against the question.
 *
 * A champion outside the candidate list is dropped rather than shown — it is
 * banned, burned or picked, and a suggestion the drafter cannot take is
 * worse than a shorter list. The candidate's own spelling is used, so the
 * app can resolve its icon.
 */
export function parseAdvice(value: unknown, candidates: readonly string[]): DraftAdvice {
  const v = (value ?? {}) as Record<string, unknown>;
  const allowed = new Map(candidates.map((c) => [norm(c), c]));
  const resolve = (name: unknown) => (typeof name === 'string' ? allowed.get(norm(name)) : undefined);

  const picks = Array.isArray(v.picks)
    ? v.picks
        .map((p) => {
          const row = (p ?? {}) as Record<string, unknown>;
          const champion = resolve(row.champion);
          if (!champion) return null;
          const confidence = row.confidence === 'high' || row.confidence === 'low' ? row.confidence : 'medium';
          return { champion, seat: role(row.seat), why: str(row.why, 400), confidence };
        })
        .filter((x): x is DraftAdvice['picks'][number] => !!x)
        .slice(0, 3)
    : [];

  const bans = Array.isArray(v.bans)
    ? v.bans
        .map((b) => {
          const row = (b ?? {}) as Record<string, unknown>;
          const champion = resolve(row.champion);
          return champion ? { champion, why: str(row.why, 400) } : null;
        })
        .filter((x): x is DraftAdvice['bans'][number] => !!x)
        .slice(0, 3)
    : [];

  return {
    summary: str(v.summary, 600),
    picks,
    bans,
    watch: strList(v.watch, 3, 300)
  };
}
