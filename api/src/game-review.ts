/**
 * The post-game review: what goes to the model and what comes back.
 *
 * Two questions per game, each to a model that fits it (8 Sep 2026): the
 * team and the draft to Opus — did the comp play out, what to work on, what
 * to keep doing — and a note per player to Sonnet, which is many short
 * answers over the same facts. Neither sees the timeline; both see the
 * facts the Games page shows (`game-facts.ts`), so anything the model says
 * can be checked against what the team already reads.
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

export const REVIEW_VERSION = 1;
export const TEAM_MODEL = 'claude-opus-5';
export const PLAYER_MODEL = 'claude-sonnet-5';
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
    lane?: LaneRead;
    facts?: PlayerFacts;
  }[];
}

export interface ReviewContext {
  teamName: string;
  tier: 'timeline' | 'endOfGame';
  game: ReviewGameLike;
  facts: GameFacts;
  /** Our deaths from the timeline, for the player notes. Absent on the replay tier. */
  deaths?: { seat: LaneRole; minute: number; zone: string; killers: number; warded: boolean; executed: boolean }[];
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
- Offer choices and questions, not orders: "one option is", "either … or", "worth asking whether". Highlight the decisions that mattered; do not dictate a single play.
- This is a finished game. Say nothing about a game in progress.
- Positions, "near" and "warded" come from one frame a minute and are approximate; say "around minute 14", not "at 14:07".
- Plain sentences a player can read on a phone. No headings, no markdown, no bullet characters inside a string.`;

export const TEAM_SYSTEM = `You are the coach reviewing one finished League of Legends game for an amateur five-stack. You are given what the team drafted and what they expected the comp to do, then the facts of the game with the minutes. You say, in a few plain sentences, whether the game went the way the draft intended, what to work on next, and what to keep doing.

${RULES}

Length: "summary" is two sentences at most. "workOn" is at most three items and "keepDoing" at most two, each a sentence with the evidence beside it. "compVerdict" is "as drafted" when the comp did what its axes and game plan expected, "off plan" when it did not, "unclear" when the facts cannot say. "compWhy" is one sentence.`;

export const PLAYER_SYSTEM = `You are the coach writing one short note per player after one finished League of Legends game for an amateur five-stack. For each of OUR players you are given their seat, champion, line, lane read, habits and deaths. You write one strength and one thing to work on per player, each tied to a fact.

${RULES}

Length: one entry per player in OUR PLAYERS, in the same order, using exactly the name given. "strength" and "workOn" are each one sentence with the evidence beside it. A player with nothing to fault still gets a "workOn" phrased as a question to ask themselves.`;

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

function happenedSection(ctx: ReviewContext): string[] {
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
  if (ctx.tier === 'endOfGame') lines.push('TIER: totals only, from a replay file. There are no minutes, no positions and no per-minute figures; say so where it matters and do not infer timing.');
  return lines;
}

function noteSection(ctx: ReviewContext): string[] {
  return ctx.note ? ['OUR OWN NOTE (written by the team, may be in Afrikaans)', ctx.note] : [];
}

/** The team question, as text the model reads once. */
export function buildTeamPrompt(ctx: ReviewContext): string {
  return [`TEAM: ${ctx.teamName}`, '', ...gameSection(ctx), '', ...compSection(ctx), '', ...happenedSection(ctx), '', ...noteSection(ctx)].join('\n').trim();
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
    per.push(`- ${p.name} (${p.seat}, ${p.champion}): ${s.kills}/${s.deaths}/${s.assists}, ${s.cs} CS${s.visionScore !== undefined ? `, vision ${s.visionScore}` : ''}.`);
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
        f.damageShare !== undefined ? `${Math.round(f.damageShare * 100)}% of the team’s damage` : null
      ].filter(Boolean);
      if (bits.length) per.push(`  Habits: ${bits.join(', ')}.`);
    }
    const deaths = (ctx.deaths ?? []).filter((d) => d.seat === p.seat);
    if (deaths.length) {
      per.push(`  Deaths: ${deaths.map((d) => `minute ${d.minute} in ${d.zone.replace(/([A-Z])/g, ' $1').toLowerCase()}${d.executed ? ' to a tower or monster' : d.killers <= 1 ? ' alone' : ` to ${d.killers}`}${d.warded ? ', warded' : ', no ward nearby'}`).join('; ')}.`);
    }
    const seatLane = ctx.facts.lanes.find((l) => l.seat === p.seat);
    if (seatLane && seatLane.flippedAt !== undefined) per.push(`  The lane’s gold lead changed hands around minute ${seatLane.flippedAt}.`);
    const vision = ctx.facts.vision.find((v) => v.seat === p.seat);
    if (vision) per.push(`  ${vision.line}`);
    const spend = ctx.facts.spend.find((x) => x.seat === p.seat);
    if (spend?.firstItemMinute !== undefined) per.push(`  First item’s worth of gold spent by minute ${spend.firstItemMinute}, ${spend.backs} backs.`);
  }
  return [`TEAM: ${ctx.teamName}`, '', ...gameSection(ctx), '', ...compSection(ctx), '', ...happenedSection(ctx), '', ...per, '', ...noteSection(ctx)].join('\n').trim();
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

export const TEAM_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two sentences at most: how the game went and why.' },
    workOn: { type: 'array', description: 'At most three, most important first.', items: evidenced },
    keepDoing: { type: 'array', description: 'At most two.', items: evidenced },
    compVerdict: { type: 'string', enum: ['as drafted', 'off plan', 'unclear'] },
    compWhy: { type: 'string', description: 'One sentence on the verdict.' }
  },
  required: ['summary', 'workOn', 'keepDoing', 'compVerdict', 'compWhy'],
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
          workOn: evidenced
        },
        required: ['name', 'strength', 'workOn'],
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
}

export interface TeamReview {
  summary: string;
  workOn: Evidenced[];
  keepDoing: Evidenced[];
  compVerdict: 'as drafted' | 'off plan' | 'unclear';
  compWhy: string;
}

export interface PlayerNote {
  name: string;
  seat: LaneRole;
  champion: string;
  strength: Evidenced;
  workOn: Evidenced;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function evidencedOf(v: unknown, textMax: number, durationMin: number): Evidenced | null {
  const row = (v ?? {}) as Record<string, unknown>;
  const text = str(row.text, textMax);
  const evidence = str(row.evidence, 160);
  if (!text || !evidence) return null;
  const m = typeof row.minute === 'number' && Number.isFinite(row.minute) ? Math.round(row.minute) : null;
  const minute = m !== null && m >= 0 && m <= Math.max(durationMin, 1) ? m : null;
  return { text, evidence, minute };
}

/** The team answer, capped and checked; anything without evidence is dropped. */
export function parseTeamReview(value: unknown, ctx: ReviewContext): TeamReview {
  const v = (value ?? {}) as Record<string, unknown>;
  const d = ctx.facts.durationMin;
  const items = (list: unknown, max: number) =>
    Array.isArray(list)
      ? list
          .map((x) => evidencedOf(x, 240, d))
          .filter((x): x is Evidenced => !!x)
          .slice(0, max)
      : [];
  const verdict = v.compVerdict === 'as drafted' || v.compVerdict === 'off plan' ? v.compVerdict : 'unclear';
  return {
    summary: str(v.summary, 400),
    workOn: items(v.workOn, 3),
    keepDoing: items(v.keepDoing, 2),
    compVerdict: ctx.comp ? verdict : 'unclear',
    compWhy: str(v.compWhy, 240)
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
    const strength = evidencedOf(row.strength, 200, ctx.facts.durationMin);
    const workOn = evidencedOf(row.workOn, 200, ctx.facts.durationMin);
    if (!strength && !workOn) continue;
    seen.add(player.name);
    const blank: Evidenced = { text: '', evidence: '', minute: null };
    out.push({ name: player.name, seat: player.seat, champion: player.champion, strength: strength ?? blank, workOn: workOn ?? blank });
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
