/**
 * The post-game review: what goes to the model and what comes back.
 *
 * Two questions per game (8 Sep 2026): the team and the draft — did the
 * comp play out, the game in moments, what to work on, what to keep doing —
 * and the notes per player: a strength, the first thing to work on, and up
 * to three more, each on its own fact. Both go to Opus since version 3
 * (9 Sep 2026): the player notes reason over the death ledger, which asks
 * for more than many short answers. Neither sees the timeline; both see the
 * facts the Games page shows (`game-facts.ts`), the ledger included, so
 * anything the model says can be checked against what the team already
 * reads. Version 4 (10 Sep 2026) adds what the film room asks the team to
 * call back: up to three lessons on facts the points already used, the one
 * thing to watch for next game, the seats a moment is about, and the two
 * choices a work-on sentence offers.
 *
 * Rules that came from Riot's policies and are enforced twice, in the
 * prompt and in the validators:
 * - Our own players only. The other team enters as a champion in a seat;
 *   no names, no ratings, no remarks about a person on the other side.
 * - Choices, not orders. The review highlights the decisions that mattered
 *   and offers options; it never dictates one move.
 * - Post-game only. Nothing here reads a live game.
 * - Every point cites a fact, with the minute where one exists. Anything
 *   the model invents beyond the schema and the caps is dropped.
 *
 * Pure: request validation, prompts, schemas, answer validation, the pick of
 * games to review each morning, and the cost arithmetic. The calls and the
 * writes live in index.ts.
 */
import { CompExpectation } from './daily-refresh';
import { compareCurve, GameFacts, k } from './game-facts';
import { LaneRead, LaneRole, PlayerFacts } from './lane-read';

export const REVIEW_VERSION = 4;

/** What a team point is about; the panel shows it as a tag with an icon. */
export const REVIEW_THEMES = ['draft', 'lanes', 'fights', 'objectives', 'vision', 'tempo', 'macro'] as const;
export type ReviewTheme = (typeof REVIEW_THEMES)[number];
export const TEAM_MODEL = 'claude-opus-5';
export const PLAYER_MODEL = 'claude-opus-5';
/** Reviews written by a morning run, at most. */
export const MAX_AUTO_REVIEWS = 3;
export const MAX_NOTE = 1500;

/** Dollars per million tokens, list price on 8 Sep 2026; an estimate the stored usage checks. */
export const PRICE_PER_MTOK: Record<string, { input: number; cachedInput: number; output: number }> = {
  'claude-opus-5': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-sonnet-5': { input: 2, cachedInput: 0.2, output: 10 }
};

export const ROLES: readonly LaneRole[] = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const LEVELS = new Set(['low', 'mid', 'high']);

// ---- The request ---------------------------------------------------------------

export interface GameReviewRequest {
  matchId: string;
  /** The comp's axes as the page shows them right now, over what is stored. */
  expect?: CompExpectation | null;
}

export function parseGameReviewRequest(body: unknown): GameReviewRequest {
  if (!body || typeof body !== 'object') throw new Error('Invalid payload. Expected a JSON object.');
  const b = body as Record<string, unknown>;
  const matchId = typeof b.matchId === 'string' ? b.matchId.trim() : '';
  if (!/^[A-Za-z0-9]+[_-]\d+$/.test(matchId)) throw new Error('matchId must be a Riot match id or a replay id.');
  let expect: CompExpectation | null | undefined;
  if (b.expect && typeof b.expect === 'object') {
    const e = b.expect as Record<string, unknown>;
    const axes = ['early', 'scaling', 'objectives', 'teamfight'] as const;
    if (!axes.every((a) => typeof e[a] === 'string' && LEVELS.has(e[a] as string))) throw new Error('expect must carry low, mid or high on all four axes.');
    expect = { early: e.early, scaling: e.scaling, objectives: e.objectives, teamfight: e.teamfight } as CompExpectation;
  } else if (b.expect === null) {
    expect = null;
  }
  return { matchId, ...(expect !== undefined && { expect }) };
}

// ---- The context ---------------------------------------------------------------

export interface ReviewPlayer {
  name: string;
  seat: LaneRole;
  champion: string;
}

export interface ReviewGameLike {
  queue: string;
  date: number;
  win: boolean;
  durationSec?: number;
  side?: 'blue' | 'red';
  enemies?: { position: string; champion: string }[];
  players: {
    name: string;
    position: string;
    champion: string;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    visionScore?: number;
    killParticipation?: number;
    damage?: number;
    damageTaken?: number;
    ccTime?: number;
    buildingDamage?: number;
    lane?: LaneRead;
    facts?: PlayerFacts;
  }[];
}

export interface ReviewContext {
  teamName: string;
  tier: 'timeline' | 'endOfGame';
  game: ReviewGameLike;
  facts: GameFacts;
  comp: {
    id: string;
    name: string;
    expect: CompExpectation | null;
    expectSource?: string;
    gamePlan?: { early?: string; mid?: string; late?: string };
    notes?: string;
  } | null;
  /** The team's own match note, trimmed. */
  note: string;
  players: ReviewPlayer[];
}

/** Our five as the review names them, from the game's players. */
export function reviewPlayers(game: ReviewGameLike): ReviewPlayer[] {
  return game.players
    .filter((p) => (ROLES as readonly string[]).includes(p.position))
    .map((p) => ({ name: p.name, seat: p.position as LaneRole, champion: p.champion }))
    .sort((a, b) => ROLES.indexOf(a.seat) - ROLES.indexOf(b.seat));
}

// ---- The prompts ---------------------------------------------------------------

const RULES = `Rules that never bend:
- Review OUR players only. The other team appears as a champion in a seat. Never describe, rate, praise or criticise a person on the other team; you may name their champions as matchups.
- Every point cites a fact from WHAT HAPPENED, with the minute where one exists. Never invent a number, a minute or an event that is not there.
- Offer choices, not orders — and say the choice outright: "either X or Y", "next time, X, or Y if Z". Highlight the decisions that mattered; do not dictate a single play.
- Be concrete. Every point names the thing: a champion, a minute, an objective, a figure from the facts. "Deaths were the story" is not a point; "Leona died nine times, and six of those engages went in before Jinx was in range" is.
- Lead with the decision that decided the game. Then the rest, most important first.
- Each point rests on a different fact. Do not repeat a figure across points, and do not restate the summary.
- One point per theme. A second point on the same theme is allowed only when it rests on a different fact, and then it says what is new in it.
- Evidence is figures only, no sentence: "Leona 1/9/7 · kills 14-35 · first tower conceded". Never repeat the point's own words in its evidence.
- No throat-clearing. Never write "it is worth asking whether", "worth reviewing whether", "is there a way to", "one option is agreeing". Say what happened, then the choice.
- This is a finished game. Say nothing about a game in progress.
- Positions, "near" and "warded" come from one frame a minute and are approximate; say "around minute 14", not "at 14:07".
- The death ledger tags what would have stopped a death, by rules over those frames. "Our jungler a screen away" is a pathing choice and belongs in the jungler's notes; "no ward nearby" belongs to whoever should have warded the spot; "their jungler was already close" belongs to the team's calls; "alone on their side" to the player who stood there. Never blame a laner for a gank nobody could have seen.
- Plain sentences a player can read on a phone. No headings, no markdown, no bullet characters inside a string.`;

export const TEAM_SYSTEM = `You are the coach reviewing one finished League of Legends game for an amateur five-stack. You are given what the team drafted and what they expected the comp to do, then the facts of the game with the minutes. You say, in a few plain sentences, whether the game went the way the draft intended, what to work on next, and what to keep doing.

${RULES}

Length: "headline" is at most eight words that name how the game was decided, like "Lost in the fights, not the farm" or "Won off two dragons and a Baron". "summary" is two sentences at most and must not repeat the headline. "workOn" is at most three items and "keepDoing" at most two, each one sentence of at most 40 words with the evidence beside it in at most 25 words, each tagged with the "theme" it is about. "compVerdict" is "as drafted" when the comp did what its axes and game plan expected, "off plan" when it did not, "unclear" when the facts cannot say. "compWhy" is one sentence. "moments" is three to six entries in time order that walk through the game: the minute, one sentence of at most 30 words on what happened and why it mattered, and "swing" for whose way it went. A moment's "seats" names the seats of ours it is about, at most three, and stays empty when it is about the whole team. A "workOn" item that offers a choice carries its two choices again in "options" as short imperatives, and leaves them out when it offers none. "lessons" is at most three things a player should be able to answer tomorrow, each on a fact already used by "workOn" or "keepDoing" and about OUR play only: a question of at most 20 words, three options of at most 12 words with one true and the wrong ones plausible, "answer" as the index of the true one, and "why" as one sentence of at most 25 words citing the fact and the minute. "oneThing" is the one thing to watch for next game in at most twelve words, a choice not an order.`;

export const PLAYER_SYSTEM = `You are the coach writing the notes per player after one finished League of Legends game for an amateur five-stack. For each of OUR players you are given their seat, champion, line, lane read, habits, damage, and their deaths one by one with what would have stopped each. You write, per player, one strength, the first thing to work on, and up to three more things to work on, each tied to a different fact.

${RULES}

Length: one entry per player in OUR PLAYERS, in the same order, using exactly the name given. Speak to the player as "you". "strength" and "workOn" are each one sentence of at most 35 words that open with the concrete fact and end with what to keep or what to change, with the evidence beside it in at most 25 words. "more" is at most three further things to work on, most important first, each one sentence of at most 35 words with evidence of at most 25 words and a "theme"; each rests on a fact the other points do not use. A player with nothing to fault gets a "workOn" that names the next step up, not a question, and a short "more"; never pad. The jungler's notes weigh the laners' deaths within reach first: for each, say where the jungler was and the choice — either be there by that minute, or tell the lane to hold.`;

function dateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function level(l: string): string {
  return l === 'high' ? 'strong' : l === 'low' ? 'weak' : 'average';
}

function gameSection(ctx: ReviewContext): string[] {
  const g = ctx.game;
  const minutes = Math.round((g.durationSec ?? 0) / 60);
  const lines = [
    'GAME',
    `${g.queue} game on ${dateOf(g.date)}, ${g.win ? 'won' : 'lost'} in ${minutes} minutes${g.side ? ` on the ${g.side} side` : ''}.`,
    'OUR PLAYERS (seat, name, champion, kills/deaths/assists, CS, vision score):'
  ];
  for (const p of ctx.players) {
    const s = g.players.find((x) => x.name === p.name);
    if (!s) continue;
    lines.push(`- ${p.seat}: ${p.name} on ${p.champion}, ${s.kills}/${s.deaths}/${s.assists}, ${s.cs} CS${s.visionScore !== undefined ? `, vision ${s.visionScore}` : ''}${s.killParticipation !== undefined ? `, ${Math.round(s.killParticipation * 100)}% kill participation` : ''}`);
  }
  if (g.enemies?.length) lines.push(`THEIR CHAMPIONS: ${g.enemies.map((e) => `${e.position}: ${e.champion}`).join(', ')}`);
  const damage = ctx.players
    .map((p) => {
      const s = g.players.find((x) => x.name === p.name);
      if (!s || s.damage === undefined) return null;
      return `${p.seat} ${k(s.damage)} dealt${s.damageTaken !== undefined ? ` / ${k(s.damageTaken)} taken` : ''}`;
    })
    .filter(Boolean);
  if (damage.length) lines.push(`DAMAGE TO CHAMPIONS, dealt / taken: ${damage.join(', ')}.`);
  return lines;
}

function compSection(ctx: ReviewContext): string[] {
  if (!ctx.comp) return ['THE COMP', 'This game was not one of the team’s named comps.'];
  const c = ctx.comp;
  const lines = ['THE COMP AND WHAT IT EXPECTS', `Comp: ${c.name}.`];
  if (c.expect) {
    lines.push(
      `Expected: ${level(c.expect.early)} early game, ${level(c.expect.scaling)} scaling, ${level(c.expect.objectives)} objective control, ${level(c.expect.teamfight)} teamfight${c.expectSource === 'edited' ? ' (set by the team)' : ' (read off the champions)'}.`
    );
    const vs = compareCurve(c.expect, ctx.facts.curve);
    if (vs.length) lines.push(`The curve against that: ${vs.join(' ')}`);
  }
  const plan = c.gamePlan;
  if (plan?.early) lines.push(`Game plan, early: ${plan.early}`);
  if (plan?.mid) lines.push(`Game plan, mid: ${plan.mid}`);
  if (plan?.late) lines.push(`Game plan, late: ${plan.late}`);
  if (c.notes) lines.push(`Comp notes: ${c.notes}`);
  return lines;
}

function happenedSection(ctx: ReviewContext, withLedger: boolean): string[] {
  const f = ctx.facts;
  const lines = ['WHAT HAPPENED', ...f.lines];
  const c = f.curve;
  const marks = (['at10', 'at15', 'at20', 'at25'] as const).filter((m) => c[m] !== undefined).map((m) => `${m.slice(2)} min ${(c[m] as number) >= 0 ? '+' : '-'}${k(c[m] as number)}`);
  if (marks.length) lines.push(`Team gold, ours minus theirs: ${marks.join(', ')}.`);
  const extra = [
    ...f.lanes.filter((l) => !f.lines.includes(l.line)).map((l) => l.line),
    ...f.objectives.filter((o) => !f.lines.includes(o.line)).map((o) => o.line),
    ...f.deathClusters.filter((d) => !f.lines.includes(d.line)).map((d) => d.line),
    ...f.soloDeaths.filter((d) => !f.lines.includes(d.line)).map((d) => d.line),
    ...f.vision.filter((v) => !f.lines.includes(v.line)).map((v) => v.line)
  ];
  lines.push(...extra);
  const spend = f.spend.filter((s) => s.firstItemMinute !== undefined).map((s) => `${s.seat} had a first item’s worth of gold spent by minute ${s.firstItemMinute} over ${s.backs} backs`);
  if (spend.length) lines.push(`${spend.join('; ')}.`);
  if (withLedger && f.ledger?.length) lines.push('OUR DEATHS, ONE BY ONE (what would have stopped each is a rule over one frame a minute)', ...f.ledger.map((d) => d.line));
  if (ctx.tier === 'endOfGame') lines.push('TIER: totals only, from a replay file. There are no minutes, no positions and no per-minute figures; say so where it matters and do not infer timing.');
  return lines;
}

function noteSection(ctx: ReviewContext): string[] {
  return ctx.note ? ['OUR OWN NOTE (written by the team, may be in Afrikaans)', ctx.note] : [];
}

/** The team question, as text the model reads once. */
export function buildTeamPrompt(ctx: ReviewContext): string {
  return [`TEAM: ${ctx.teamName}`, '', ...gameSection(ctx), '', ...compSection(ctx), '', ...happenedSection(ctx, true), '', ...noteSection(ctx)].join('\n').trim();
}

function fmt(n: number | undefined, unit = ''): string | null {
  return n === undefined ? null : `${Math.round(n * 10) / 10}${unit}`;
}

/** The player question: the same context, then a block per player. */
export function buildPlayerPrompt(ctx: ReviewContext): string {
  const per: string[] = ['OUR PLAYERS, ONE BY ONE'];
  for (const p of ctx.players) {
    const s = ctx.game.players.find((x) => x.name === p.name);
    if (!s) continue;
    const figures = [
      s.damage !== undefined ? `${k(s.damage)} damage to champions` : null,
      s.damageTaken !== undefined ? `${k(s.damageTaken)} taken` : null,
      s.ccTime !== undefined ? `${Math.round(s.ccTime)} s of crowd control` : null,
      s.buildingDamage !== undefined ? `${k(s.buildingDamage)} to buildings` : null
    ].filter(Boolean);
    per.push(`- ${p.name} (${p.seat}, ${p.champion}): ${s.kills}/${s.deaths}/${s.assists}, ${s.cs} CS${s.visionScore !== undefined ? `, vision ${s.visionScore}` : ''}${figures.length ? `, ${figures.join(', ')}` : ''}.`);
    const lane = s.lane;
    if (lane && lane.verdict !== 'unknown') {
      const bits = [
        fmt(lane.goldPerMinDiff, ' gold/min vs lane'),
        fmt(lane.csAt10Diff, ' CS at ten vs lane'),
        fmt(lane.visionPerMinDiff, ' vision/min vs lane'),
        lane.levelLead !== undefined ? `${lane.levelLead} level lead at most` : null
      ].filter(Boolean);
      per.push(`  Lane ${lane.verdict} into ${lane.theirChampion}${bits.length ? `: ${bits.join(', ')}` : ''}.`);
    }
    const f = s.facts;
    if (f) {
      const bits = [
        fmt(f.goldPerMin, ' gold/min'),
        f.csAt10 !== undefined ? `${f.csAt10} CS at ten` : null,
        f.controlWards !== undefined ? `${f.controlWards} control wards` : null,
        f.wardTakedowns !== undefined ? `${f.wardTakedowns} wards cleared` : null,
        f.soloKills !== undefined ? `${f.soloKills} solo kills` : null,
        f.timeDeadSec !== undefined ? `${Math.round(f.timeDeadSec / 60)} min dead` : null,
        f.plates !== undefined ? `${f.plates} plates` : null,
        f.hasTeleport && f.tpTakedowns !== undefined ? `${f.tpTakedowns} Teleport takedowns` : null,
        f.damageShare !== undefined ? `${Math.round(f.damageShare * 100)}% of the team’s damage` : null,
        fmt(f.visionPerMin, ' vision/min'),
        f.dragonTakedowns !== undefined ? `${f.dragonTakedowns} dragon takedowns` : null,
        f.baronTakedowns !== undefined ? `${f.baronTakedowns} baron takedowns` : null,
        f.killsNearEnemyTurret !== undefined ? `${f.killsNearEnemyTurret} kills under their tower` : null
      ].filter(Boolean);
      if (bits.length) per.push(`  Habits: ${bits.join(', ')}.`);
    }
    const ledger = ctx.facts.ledger ?? [];
    const mine = ledger.filter((d) => d.seat === p.seat);
    if (mine.length) per.push('  Deaths, one by one:', ...mine.map((d) => `    ${d.line}`));
    if (p.seat === 'Jungle' && ctx.facts.ledger) {
      const reach = ledger.filter((d) => d.seat !== 'Jungle' && d.could.includes('jungle'));
      if (reach.length) per.push("  Laners' deaths within your reach, about a screen away at the nearest frame:", ...reach.map((d) => `    ${d.line}`));
      else per.push('  No laner died within your reach.');
      if (ctx.facts.presence) per.push(`  ${ctx.facts.presence.line}`);
    }
    const seatLane = ctx.facts.lanes.find((l) => l.seat === p.seat);
    if (seatLane && seatLane.flippedAt !== undefined) per.push(`  The lane’s gold lead changed hands around minute ${seatLane.flippedAt}.`);
    const vision = ctx.facts.vision.find((v) => v.seat === p.seat);
    if (vision) per.push(`  ${vision.line}`);
    const spend = ctx.facts.spend.find((x) => x.seat === p.seat);
    if (spend?.firstItemMinute !== undefined) per.push(`  First item’s worth of gold spent by minute ${spend.firstItemMinute}, ${spend.backs} backs.`);
  }
  return [`TEAM: ${ctx.teamName}`, '', ...gameSection(ctx), '', ...compSection(ctx), '', ...happenedSection(ctx, false), '', ...per, '', ...noteSection(ctx)].join('\n').trim();
}

// ---- The schemas ---------------------------------------------------------------

const evidenced = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'One sentence.' },
    evidence: { type: 'string', description: 'The fact it rests on, with the minute where there is one.' },
    minute: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'The minute the point is about, or null.' }
  },
  required: ['text', 'evidence', 'minute'],
  additionalProperties: false
} as const;

const themedPoint = {
  type: 'object',
  properties: {
    ...evidenced.properties,
    theme: { type: 'string', enum: [...REVIEW_THEMES], description: 'What the point is about.' }
  },
  required: ['text', 'evidence', 'minute', 'theme'],
  additionalProperties: false
} as const;

/** A team work-on: a themed point that may carry the two choices its sentence offers. */
const choicePoint = {
  type: 'object',
  properties: {
    ...themedPoint.properties,
    options: {
      type: 'array',
      items: { type: 'string' },
      description: 'The two choices the sentence offers, as short imperatives; only when the sentence offers a choice.'
    }
  },
  required: ['text', 'evidence', 'minute', 'theme'],
  additionalProperties: false
} as const;

const lesson = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'At most 20 words, on our play.' },
    options: { type: 'array', items: { type: 'string' }, description: 'Three options of at most 12 words, one true, the wrong ones plausible.' },
    answer: { type: 'integer', description: 'The index of the true option.' },
    why: { type: 'string', description: 'One sentence of at most 25 words citing the fact and the minute.' },
    theme: { type: 'string', enum: [...REVIEW_THEMES], description: 'What the lesson is about.' }
  },
  required: ['question', 'options', 'answer', 'why', 'theme'],
  additionalProperties: false
} as const;

export const TEAM_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'At most eight words naming how the game was decided.' },
    summary: { type: 'string', description: 'Two sentences at most: how the game went and why. Not a repeat of the headline.' },
    workOn: { type: 'array', description: 'At most three, most important first.', items: choicePoint },
    keepDoing: { type: 'array', description: 'At most two.', items: themedPoint },
    compVerdict: { type: 'string', enum: ['as drafted', 'off plan', 'unclear'] },
    compWhy: { type: 'string', description: 'One sentence on the verdict.' },
    moments: {
      type: 'array',
      description: 'Three to six moments in time order that walk through the game.',
      items: {
        type: 'object',
        properties: {
          minute: { type: 'number' },
          text: { type: 'string', description: 'One sentence: what happened and why it mattered.' },
          swing: { type: 'string', enum: ['us', 'them', 'even'], description: 'Whose way it went.' },
          seats: {
            type: 'array',
            items: { type: 'string', enum: [...ROLES] },
            description: 'The seats this moment is about, at most three, only when it is about particular seats.'
          }
        },
        required: ['minute', 'text', 'swing', 'seats'],
        additionalProperties: false
      }
    },
    lessons: {
      type: 'array',
      description:
        'Up to three things a player should be able to answer tomorrow, each on a fact already used by workOn or keepDoing, about OUR play only; three options, one true, the wrong ones plausible; question at most 20 words, options at most 12 words, why one sentence of at most 25 words citing the fact and the minute',
      items: lesson
    },
    oneThing: { type: 'string', description: 'The one thing to watch for next game, at most twelve words, a choice not an order' }
  },
  required: ['headline', 'summary', 'workOn', 'keepDoing', 'compVerdict', 'compWhy', 'moments', 'lessons', 'oneThing'],
  additionalProperties: false
} as const;

export const PLAYER_SCHEMA = {
  type: 'object',
  properties: {
    players: {
      type: 'array',
      description: 'One per player in OUR PLAYERS, same order, exact names.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          strength: evidenced,
          workOn: evidenced,
          more: { type: 'array', description: 'At most three further things to work on, most important first, each on a different fact; fewer when there is less to say.', items: themedPoint }
        },
        required: ['name', 'strength', 'workOn', 'more'],
        additionalProperties: false
      }
    }
  },
  required: ['players'],
  additionalProperties: false
} as const;

// ---- The answers ---------------------------------------------------------------

export interface Evidenced {
  text: string;
  evidence: string;
  minute: number | null;
  /** Team points and a player's further points. */
  theme?: ReviewTheme;
  /** The two choices the sentence offers, when it offers one; team work-ons since version 4. */
  options?: [string, string];
}

/** One step of the walk through the game. */
export interface Moment {
  minute: number;
  text: string;
  swing: 'us' | 'them' | 'even';
  /** The seats of ours it is about, at most three; absent when it is about the whole team, and before version 4. */
  seats?: LaneRole[];
}

/** Something a player should be able to answer tomorrow, on a fact the points already used; version 4. */
export interface Lesson {
  question: string;
  /** Three, distinct. */
  options: string[];
  /** The index of the true option. */
  answer: number;
  why: string;
  theme?: ReviewTheme;
}

export interface TeamReview {
  /** At most eight words on how the game was decided; absent on reviews before version 2. */
  headline?: string;
  summary: string;
  workOn: Evidenced[];
  keepDoing: Evidenced[];
  compVerdict: 'as drafted' | 'off plan' | 'unclear';
  compWhy: string;
  /** In time order; absent before version 3. */
  moments?: Moment[];
  /** At most three; absent before version 4. */
  lessons?: Lesson[];
  /** At most twelve words, a choice not an order; absent before version 4 and when the model gave none. */
  oneThing?: string;
}

export interface PlayerNote {
  name: string;
  seat: LaneRole;
  champion: string;
  strength: Evidenced;
  workOn: Evidenced;
  /** Further things to work on, at most three; absent before version 3. */
  more?: Evidenced[];
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
/** `str`, but a cut lands on a word boundary when there is one, so the twelfth word is never half a word. */
const strWords = (v: unknown, max: number): string => {
  const whole = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (whole.length <= max) return whole;
  const cut = whole.slice(0, max);
  if (whole[max] === ' ') return cut;
  const space = cut.lastIndexOf(' ');
  return space > 0 ? cut.slice(0, space) : cut;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** A Riot id, as in Name#EUW: a name stuck to a tag of two to five letters and digits with at least one letter, so "#20" in "Group at #20" is not one. The tag is a person's, never shown. */
const RIOT_ID = /(\S+?)#(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{2,5}\b/g;

function themeOf(v: unknown): ReviewTheme | undefined {
  return (REVIEW_THEMES as readonly string[]).includes(v as string) ? (v as ReviewTheme) : undefined;
}

/** The two choices a sentence offers: kept only when there are exactly two and both say something. */
function optionsOf(v: unknown): [string, string] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const a = str(v[0], 90);
  const b = str(v[1], 90);
  return a && b ? [a, b] : undefined;
}

function evidencedOf(v: unknown, textMax: number, durationMin: number): Evidenced | null {
  const row = (v ?? {}) as Record<string, unknown>;
  const text = str(row.text, textMax);
  const evidence = str(row.evidence, 220);
  if (!text || !evidence) return null;
  const m = typeof row.minute === 'number' && Number.isFinite(row.minute) ? Math.round(row.minute) : null;
  const minute = m !== null && m >= 0 && m <= Math.max(durationMin, 1) ? m : null;
  const theme = themeOf(row.theme);
  const options = optionsOf(row.options);
  return { text, evidence, minute, ...(theme && { theme }), ...(options && { options }) };
}

function pointsOf(list: unknown, max: number, durationMin: number): Evidenced[] {
  return Array.isArray(list)
    ? list
        .map((x) => evidencedOf(x, 320, durationMin))
        .filter((x): x is Evidenced => !!x)
        .slice(0, max)
    : [];
}

/** The walk through the game: in time order, inside the game, at most six; a moment's seats are ours, at most three. */
function momentsOf(list: unknown, durationMin: number, seats: readonly LaneRole[]): Moment[] {
  if (!Array.isArray(list)) return [];
  const out: Moment[] = [];
  for (const raw of list) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const text = str(row.text, 240);
    const m = typeof row.minute === 'number' && Number.isFinite(row.minute) ? Math.round(row.minute) : null;
    if (!text || m === null || m < 0 || m > Math.max(durationMin, 1)) continue;
    const swing = row.swing === 'us' || row.swing === 'them' ? row.swing : 'even';
    const about = Array.isArray(row.seats)
      ? (row.seats.filter((s, i, all): s is LaneRole => (seats as readonly unknown[]).includes(s) && all.indexOf(s) === i) as LaneRole[]).slice(0, 3)
      : [];
    out.push({ minute: m, text, swing, ...(about.length > 0 && { seats: about }) });
  }
  return out.sort((a, b) => a.minute - b.minute).slice(0, 6);
}

/**
 * An option with the Riot tags of our own five cut off (the tag is never
 * shown, the name is ours to show), or null when it names anyone else by
 * Riot id: a person not on our five, and the lesson goes with it.
 */
function optionNamingOurs(text: string, ours: ReadonlySet<string>): string | null {
  let stranger = false;
  const out = text.replace(RIOT_ID, (whole, name: string) => {
    if (ours.has(norm(name))) return name;
    stranger = true;
    return whole;
  });
  return stranger ? null : out;
}

/**
 * The lessons: at most three, each with a question, three distinct options that
 * name nobody off our five, an answer that points at one of them, and a why.
 * A lesson missing any of that is dropped whole rather than patched, since a
 * dropped option would move the answer.
 */
function lessonsOf(list: unknown, ctx: ReviewContext): Lesson[] {
  if (!Array.isArray(list)) return [];
  const ours = new Set(ctx.players.map((p) => norm(p.name)));
  const out: Lesson[] = [];
  for (const raw of list) {
    if (out.length === 3) break;
    const row = (raw ?? {}) as Record<string, unknown>;
    const question = str(row.question, 160);
    const why = str(row.why, 200);
    const named = Array.isArray(row.options) ? row.options.map((o) => optionNamingOurs(str(o, 90), ours)) : [];
    if (!question || !why || named.length !== 3) continue;
    if (named.some((o) => !o)) continue;
    const options = named as string[];
    if (new Set(options.map((o) => o.toLowerCase())).size !== 3) continue;
    const answer = row.answer;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer > 2) continue;
    const theme = themeOf(row.theme);
    out.push({ question, options, answer, why, ...(theme && { theme }) });
  }
  return out;
}

/** The team answer, capped and checked; anything without evidence is dropped. */
export function parseTeamReview(value: unknown, ctx: ReviewContext): TeamReview {
  const v = (value ?? {}) as Record<string, unknown>;
  const d = ctx.facts.durationMin;
  const verdict = v.compVerdict === 'as drafted' || v.compVerdict === 'off plan' ? v.compVerdict : 'unclear';
  const headline = str(v.headline, 80).replace(/[.!]+$/, '');
  const oneThing = strWords(v.oneThing, 90);
  return {
    ...(headline ? { headline } : {}),
    summary: str(v.summary, 400),
    workOn: pointsOf(v.workOn, 3, d),
    keepDoing: pointsOf(v.keepDoing, 2, d),
    compVerdict: ctx.comp ? verdict : 'unclear',
    compWhy: str(v.compWhy, 240),
    moments: momentsOf(v.moments, d, ctx.players.map((p) => p.seat)),
    lessons: lessonsOf(v.lessons, ctx),
    ...(oneThing ? { oneThing } : {})
  };
}

/** The player notes, one per known player; unknown names and duplicates are dropped, seats re-stamped. */
export function parsePlayerNotes(value: unknown, ctx: ReviewContext): PlayerNote[] {
  const v = (value ?? {}) as Record<string, unknown>;
  const known = new Map(ctx.players.map((p) => [norm(p.name), p]));
  const seen = new Set<string>();
  const out: PlayerNote[] = [];
  for (const raw of Array.isArray(v.players) ? v.players : []) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const player = typeof row.name === 'string' ? known.get(norm(row.name)) : undefined;
    if (!player || seen.has(player.name)) continue;
    const strength = evidencedOf(row.strength, 320, ctx.facts.durationMin);
    const workOn = evidencedOf(row.workOn, 320, ctx.facts.durationMin);
    if (!strength && !workOn) continue;
    seen.add(player.name);
    const blank: Evidenced = { text: '', evidence: '', minute: null };
    out.push({ name: player.name, seat: player.seat, champion: player.champion, strength: strength ?? blank, workOn: workOn ?? blank, more: pointsOf(row.more, 3, ctx.facts.durationMin) });
  }
  return out.sort((a, b) => ROLES.indexOf(a.seat) - ROLES.indexOf(b.seat));
}

// ---- The morning's pick and the bill ---------------------------------------

export interface ReviewCandidateLike {
  matchId: string;
  queue: string;
  date: number;
}

/** Flex and Clash prep games with a timeline and no review yet, newest first, capped. */
export function reviewCandidates<T extends ReviewCandidateLike>(
  games: readonly T[],
  practiceIds: ReadonlySet<string>,
  timelineIds: ReadonlySet<string>,
  reviewedIds: ReadonlySet<string>,
  max = MAX_AUTO_REVIEWS
): T[] {
  return games
    .filter((g) => g.queue !== 'Scrim' && !practiceIds.has(g.matchId) && timelineIds.has(g.matchId) && !reviewedIds.has(g.matchId))
    .sort((a, b) => b.date - a.date)
    .slice(0, max);
}

export interface Usage {
  input: number;
  cachedInput: number;
  output: number;
}

/** Dollars, to the tenth of a cent, at the list prices above; unknown models cost nothing on paper. */
export function costUsd(model: string, usage: Usage): number {
  const price = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK[Object.keys(PRICE_PER_MTOK).find((m) => model.startsWith(m)) ?? ''];
  if (!price) return 0;
  const usd = (usage.input * price.input + usage.cachedInput * price.cachedInput + usage.output * price.output) / 1_000_000;
  return Math.round(usd * 1000) / 1000;
}

// ---- What is stored -----------------------------------------------------------

export interface GameReview {
  matchId: string;
  reviewedAt: string;
  reviewVersion: number;
  tier: 'timeline' | 'endOfGame';
  trigger: 'manual' | 'auto';
  models: { team: string; players: string };
  compId: string | null;
  compName: string | null;
  expect?: CompExpectation;
  team: TeamReview;
  players: PlayerNote[];
  usage: { team: Usage; players: Usage; costUsd: number; tookMs: number };
}
