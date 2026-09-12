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
 * choices a work-on sentence offers. Version 5 (10 Sep 2026) adds the draft
 * with hindsight: one sentence on how the five fit the game that was played,
 * and up to two swaps to OUR draft — a Malphite for the all-in with a Miss
 * Fortune, a Nautilus for the peel — each resolved against the champion list
 * the prompt offered, so the film can show real art for a real champion.
 * Version 6 (10 Sep 2026) widens the draft after the lead asked whether one
 * swap was all there was: up to three swaps, each with up to two alternatives
 * that would do the same job in that seat ("Orianna, or Syndra"), and what
 * the five lacked as gains with the fact behind each, so the film can show
 * the gaps as chips over the swaps. The same version adds the rule that a
 * solo death is a wave-state or trade choice and never a vision problem,
 * after a review prescribed a ward for a laner who died one-on-one.
 *
 * A recorded game (10 Sep 2026): a custom game that the local recorder
 * watched arrives as `recordedLines` — the sentences `replay-recording.ts`
 * reads off `replayRecordings/{matchId}` — inside WHAT HAPPENED, and as
 * frames of our own game attached to the team call. Since 11 Sep 2026 a
 * recording from recorder version 2 also carries the board at each death of
 * ours — what all ten were holding two seconds before it — which `deathLines`
 * prints under its own heading beside the minutes, so a point can be as
 * concrete as "you fell at twelve with no control ward and their jungler
 * already down for fifteen seconds". It is prompt input and nothing else:
 * there is no field for it in either schema, so `REVIEW_VERSION` does not
 * move for it.
 *
 * Version 7 (11 Sep 2026) stores `recorded` beside `tier`, because nothing in
 * a version 6 document said a review had been written off a recording: the
 * panel read `tier === 'endOfGame'` and told the lead "Totals only, nothing
 * here is timed" over a review written off forty minute-by-minute lines and
 * eight frames, and drew a dot where every minute should have been. `tier`
 * still says where the totals came from; `recorded` says whether the minutes
 * did.
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
import { displayChampionName } from './champion-names';
import { CompExpectation } from './daily-refresh';
import { compareCurve, GameFacts, k } from './game-facts';
import { LaneRead, LaneRole, PlayerFacts } from './lane-read';
import { LaneMatchup, matchupLines } from './lane-matchups';
import { deathLines, fightLines, FIGHT_WINDOW_SEC, MAX_DEATH_LINES, MAX_FIGHT_LINES, ReplayRecording } from './replay-recording';

export const REVIEW_VERSION = 8;

/** What a team point is about; the panel shows it as a tag with an icon. */
export const REVIEW_THEMES = ['draft', 'lanes', 'fights', 'objectives', 'vision', 'tempo', 'macro'] as const;
export type ReviewTheme = (typeof REVIEW_THEMES)[number];
/** What a swap in the draft buys, and what a comp can lack (version 5, and version 6's "lacked"); the app mirrors this list in `team.models.ts`, so a change here is a change there. */
export const DRAFT_GAINS = ['engage', 'peel', 'frontline', 'poke', 'sustain', 'splitpush', 'waveclear', 'pick', 'disengage', 'damage'] as const;
export type DraftGain = (typeof DRAFT_GAINS)[number];
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
  /**
   * What solo queue at large did with the five pairings we drafted (12 Sep 2026), read from
   * `matchupIndex` — the crawler's own published rates, which until now only the draft room ever
   * opened. Absent when the crawler has not reached this patch, and empty when no lane cleared
   * `MIN_MATCHUP_GAMES`; both are ordinary, and the block simply does not print.
   */
  laneMatchups?: LaneMatchup[];
  /** The team's own match note, trimmed. */
  note: string;
  players: ReviewPlayer[];
  /**
   * Every champion's display name in Data Dragon's spelling ("Miss Fortune",
   * "Kai'Sa", "Wukong"), sorted, from `meta/championTraits`. A swap's "in" is
   * resolved against this list and dropped otherwise, so the film never shows
   * a champion nobody can look up. Absent or empty: no swap survives.
   */
  championNames?: string[];
  /**
   * A game the local recorder watched, as sentences (10 Sep 2026;
   * `recordingLines` in `replay-recording.ts`). Riot has no match and no
   * timeline for a custom, so without a recording such a review has the
   * replay's totals and nothing else — but a recording is read on either tier
   * since 11 Sep 2026, because the frames are the only view of the map either
   * tier has, and the recorder will happily record a game Riot can also see.
   * Its minutes carry no team gold and no position; the frames attached to the
   * team call do carry both, in the top bar and the minimap, and are the only
   * view of the map either tier has.
   */
  recordedLines?: string[];
  /**
   * The recording itself, when the recorder that watched the game was new
   * enough to keep it (11 Sep 2026). `recordedLines` above is the game minute
   * by minute; this is the board at each death of ours — what all ten were
   * holding two seconds before it — and `deathLines` is what prints it.
   *
   * It is handed over whole rather than pre-printed, unlike `recordedLines`,
   * for two reasons: the prompt is the only place that knows how many boards
   * it can afford beside the frames, and it has to be able to say how many
   * deaths it left out, which a list of finished sentences can no longer tell
   * it. A recording from before the boards existed carries no `deaths` and the
   * block simply does not appear.
   */
  recording?: ReplayRecording;
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
- NAME OURS BY CHAMPION, THEIRS BY SEAT. One of ours is "Vi", "Aphelios", "Nautilus" — never "our Jungle", "our ADC", "our Support". Write "Nautilus was still 29s from respawning when Vi went in", not "our Support was still 29s from respawning when our Jungle went in". In a player's own note, speak to them as "you" and name their teammates by champion the same way: "your Top died alone" is "Mordekaiser died alone". The other side keeps the seat word — "their ADC was 37s from respawn" is right and must stay, because they have no names here. That asymmetry is the rule doing its job: a seat word on its own means the other team.
- NEVER SAY "SEAT", "THEME", "EVIDENCE", "TIER" OR "LEDGER" IN A SENTENCE A PLAYER READS. They are this tool's words, not the game's. "while a seat is still on the floor" is "while one of ours is still down".
- Every point cites a fact from WHAT HAPPENED, with the minute where one exists. Never invent a number, a minute or an event that is not there.
- Offer choices, not orders — and say the choice outright: "either X or Y", "next time, X, or Y if Z". Highlight the decisions that mattered; do not dictate a single play.
- Be concrete. Every point names the thing: a champion, a minute, an objective, a figure from the facts. "Deaths were the story" is not a point; "Leona died nine times, and six of those engages went in before Jinx was in range" is.
- Lead with the decision that decided the game. Then the rest, most important first.
- Each point rests on a different fact. Do not repeat a figure across points, and do not restate the summary.
- One point per theme. A second point on the same theme is allowed only when it rests on a different fact, and then it says what is new in it.
- EVERY FIGURE CARRIES SOMETHING BESIDES A CLOCK. "20:54" on its own is not a figure — it is a timestamp, and on the panel it draws as a chip saying nothing at all, which happened on a real review (12 Sep 2026). Say what happened at it: "20:54 no kill in return", "20:54 their ADC 37s from respawn". A minute with nothing attached belongs in the sentence, not in the evidence.
- WHEN A POINT IS ABOUT ONE OF OURS, ITS FIRST FIGURE NAMES THEM. "Akali 13/3/5 · 236 cs · ace at 13" says whose game it was at a glance; "287 CS · IE, Stormrazor and Runaan's at 25 · 33.1k dealt" is the same figures with the name missing, and the reader has to work out who it is from the farm — which happened on a real review (12 Sep 2026). The champion goes first, attached to the figure that carries them. A point about the whole team needs no name and must not invent one.
- Evidence is figures only, never a sentence, and the ONE separator between figures is a middle dot: "Leona 1/9/7 · kills 14-35 · first tower conceded". Two to five figures. The app splits on that dot and draws each figure as its own chip on the review panel, so a dot in the wrong place makes half a thought in a box — but a comma inside a single figure is fine and often right ("IE, Stormrazor and Runaan's" is one figure, not three). Never separate two figures with a comma, an "and", or a semicolon. Never repeat the point's own words in its evidence.
- "BACK" MEANS A RECALL. Never use it for a kill traded: "four of ours for one of theirs", "a four-for-one", "and killed nobody in return", "no kill in return" — never "four for one back" or "nothing back", which read as somebody recalled. The same goes for evidence: write "20:22 no kill in return", not "20:22 nothing back".
- No throat-clearing. Never write "it is worth asking whether", "worth reviewing whether", "is there a way to", "one option is agreeing". Say what happened, then the choice.
- This is a finished game. Say nothing about a game in progress.
- Positions, "near" and "warded" come from one frame a minute and are approximate; say "around minute 14", not "at 14:07".
- The death ledger tags what would have stopped a death, by rules over those frames. "Our jungler a screen away" is a pathing choice and belongs in the jungler's notes; "no ward nearby" belongs to whoever should have warded the spot; "their jungler was already close" belongs to the team's calls; "alone on their side" to the player who stood there. Never blame a laner for a gank nobody could have seen.
- A solo death - one killer, the lane opponent - is a wave-state or trade choice: the advice is to hold the wave, trade differently, or wait for the jungler before stepping up. Never prescribe a ward for a solo death, and never count a solo death as evidence about vision; 'barely a ward down' is not a reason a laner died one-on-one.
- READ THE FRAMES. Each one is captioned with the second it was taken and is a real picture of our own game, and the numbers on it are facts as good as any in the text. The top bar carries both teams' gold and both teams' objective counts at that second; the corner above the minimap carries the neutral timers, which say what objective was up and what was about to spawn; the panel across the bottom carries all ten players' items, KDA and CS; and the minimap carries where everyone stood. Use them. When a fight or a death happened with Baron or a dragon close to spawning, say so and say what it was worth — a frame is the only place that clock exists. When a number on a frame is not legible, say nothing about it rather than guess at it.
- WHOSE AN OBJECTIVE WAS IS ALREADY COUNTED FOR YOU. THE FRAMES ONLY SAY WHEN. The objective tallies in WHAT HAPPENED are the game's own final counts, ours first and theirs second, and they are exact: "heralds 1-0" means WE took the herald and they took none. Never contradict them, and never work out whose an objective was by looking at a picture — a top bar is small and the two sides sit side by side, and a review that read our own herald as theirs off a frame (12 Sep 2026) is the exact mistake this rule exists to stop. What the tallies do NOT carry is timing, and for a recorded custom game nothing else does either: the League client reports no dragon, no Baron, no herald and no grubs for such a game at all — champion kills and structures and nothing else — so the minute-by-minute list below genuinely has none, and their absence there is not evidence that none fell. Timing is the frames' one job here, and only as a bracket: two frames with different counts mean one fell between those two seconds. Say "between 12:13 and 15:41 they took a second dragon", and never state a minute the frames cannot support.
- WHAT FELL AND WHAT WAS COMING ARE TWO READINGS, never one claim. What fell is the count in a frame's top bar, and the only honest form of it is a bracket between two frames. What was coming is the neutral timer block in that frame's corner, and it is true of that second and no other — a timer reading 1:40 says Baron was 1:40 away when the picture was taken, and says nothing at all about any other minute. Do not turn one into the other, and never work a spawn time out of a respawn rule: those change with the patch and nothing you have been given carries them.
- WHERE THERE IS A FIGHTS BLOCK, THAT IS WHERE THE GAME WAS DECIDED (a recorded game only). A fight taken a man down is a different mistake from a fight lost five on five — opposite mistakes, in fact, and the team has to be told which this was. THE BLOCK SAYS BOTH, AND THEY ARE NEVER THE SAME READING. "we opened it five up" or "we opened it one down: our Support (29s left)" is the state we ENGAGED in, and it is the only thing that says whether taking the fight was the mistake. "by 33:11 we were three down" is how deep the hole got once it ran, and those seats are usually this fight's own casualties — it says the fight went badly, never that we started it short. NEVER turn the second into the first. Writing "we took a fight three men down" off a hole line, when the opening line said five up, reverses what happened and is the single worst thing you can do with this block; it happened on a real review (12 Sep 2026) and reached a work-on, a moment, a lesson and the one thing at once. Every seconds-left figure belongs to the second printed beside it and to no other. Read the counts either side of a fight as the trade it was — three of ours for four of theirs is a fight we won, whatever it felt like.
- WHERE THERE IS A LANES-AS-A-DRAFT BLOCK, IT SETTLES WHOSE PROBLEM A LANE WAS. It is the only thing in this prompt that knows whether a lane was worth taking, and a point about a seat that lost a hard matchup reads differently from the same point about a seat that lost an even one — so check it before you write one, and quote the figure when it changes what you say. Do not mention it where it changes nothing.
- Plain sentences a player can read on a phone. No headings, no markdown, no bullet characters inside a string.`;

export const TEAM_SYSTEM = `You are the coach reviewing one finished League of Legends game for an amateur five-stack. You are given what the team drafted and what they expected the comp to do, then the facts of the game with the minutes. You say, in a few plain sentences, whether the game went the way the draft intended, what to work on next, what to keep doing, and what you would draft differently with hindsight.

${RULES}
- A swap is about OUR draft. The other team's champions may be named as the matchup they posed — "into Darius", "against a Syndra" — never a person.
- When frames of the game are attached they are pictures of OUR own game, taken from the replay at the second the caption gives: read the minimap for where everyone was and the HUD for the spectated player's abilities and items, say "around minute N" because a frame is one moment and not a stretch of play, and never describe a person on the other team — a frame shows champions in seats.

Length: "decidedBy" names the ONE thing that decided this game as one of the seven themes, with "why" as at most twelve words citing a figure. It is the largest thing the team sees, above the headline, so it must name the single biggest cause and never summarise the whole game. "headline" is at most eight words that name how the game was decided, like "Lost in the fights, not the farm" or "Won off two dragons and a Baron". "summary" is two sentences of at most 45 words together and must not repeat the headline. "workOn" is at most three items and "keepDoing" at most two, each one sentence of at most 30 words with the evidence beside it in at most 18 words, each tagged with the "theme" it is about. "compVerdict" is "as drafted" when the comp did what its axes and game plan expected, "off plan" when it did not, "unclear" when the facts cannot say. "compWhy" is one sentence of at most 25 words. "moments" is three to six entries in time order that walk through the game: the minute, one sentence of at most 25 words on what happened and why it mattered, and "swing" for whose way it went. A moment's "seats" names the seats of ours it is about, at most three, and stays empty when it is about the whole team. A "workOn" item that offers a choice carries its two choices again in "options" as short imperatives, and leaves them out when it offers none. "lessons" is at most three things a player should be able to answer tomorrow, each on a fact already used by "workOn" or "keepDoing" and about OUR play only: a question of at most 20 words, three options of at most 12 words with one true and the wrong ones plausible, "answer" as the index of the true one, and "why" as one sentence of at most 25 words citing the fact and the minute. "oneThing" is the one thing to watch for next game in at most twelve words, a choice not an order. "draft" is one sentence ("verdict") on whether the five we drafted fit the game that was played, and "swaps" is at most three changes to OUR draft the coach would make with hindsight, each naming the seat, the champion we played ("out", exactly as given in OUR PLAYERS), the champion to try instead ("in", from CHAMPIONS A SWAP MAY NAME, in a similar role for that seat, a mainstream pick not a niche one, never one of our own five in that game), one sentence of at most 30 words on "why" that cites the fact and the minute (for instance the fight around minute 24 where nobody could follow the engage, or the nine deaths of the carry with nobody to peel), "gains" as what the swap buys from the list, and "alternatives" as at most two other champions from CHAMPIONS A SWAP MAY NAME that would do the same job in that seat ("Orianna, or Syndra"), empty when there is no second option; for instance a Malphite for the all-in with Miss Fortune, or a Nautilus for the peel on a hypercarry. "lacked" is what the comp was missing that the game exposed: at most three gains from the same list, each with "why" as one sentence of at most 25 words citing the fact and the minute behind it. Leave both "swaps" and "lacked" empty when the draft held.`;

export const PLAYER_SYSTEM = `You are the coach writing the notes per player after one finished League of Legends game for an amateur five-stack. For each of OUR players you are given their seat, champion, line, lane read, habits, damage, and their deaths one by one with what would have stopped each. You write, per player, one strength, the first thing to work on, and up to three more things to work on, each tied to a different fact.

${RULES}

Length: one entry per player in OUR PLAYERS, in the same order, using exactly the name given. Speak to the player as "you". "strength" and "workOn" are each one sentence of at most 28 words that open with the concrete fact and end with what to keep or what to change, with the evidence beside it in at most 18 words. "more" is at most three further things to work on, most important first, each one sentence of at most 28 words with evidence of at most 18 words and a "theme"; each rests on a fact the other points do not use. A player with nothing to fault gets a "workOn" that names the next step up, not a question, and a short "more"; never pad. The jungler's notes weigh the laners' deaths within reach first: for each, say where the jungler was and the choice — either be there by that minute, or tell the lane to hold.`;

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

/**
 * The team question's ask on the draft (version 5, 10 Sep 2026; three swaps,
 * alternatives and the gaps since version 6 the same day). The champion list
 * is printed in full so the model spells a swap the way Data Dragon does and
 * the validator can find it; a name off the list is dropped, so when there is
 * no list the prompt says so rather than let the model spend words on swaps
 * nothing will keep. What the five lacked names no champion, so it is asked
 * for either way.
 */
function draftSection(ctx: ReviewContext): string[] {
  const lines = [
    'THE DRAFT WITH HINDSIGHT',
    'Knowing how this game went, say in one sentence whether the five we drafted fit it. Then name at most three changes to OUR draft you would make with hindsight: the seat, the champion we played there, a mainstream champion in a similar role to try instead, why in one sentence on the fact and the minute, what the swap buys, and up to two other champions that would do the same job in that seat. Then say what the five lacked that the game exposed: at most three gains, each with the fact and the minute behind it. Leave the swaps and the lacked list empty when the draft held.'
  ];
  if (ctx.championNames?.length) lines.push(`CHAMPIONS A SWAP MAY NAME (Data Dragon spelling): ${ctx.championNames.join(', ')}`);
  else lines.push('No champion list is available for this review, so leave the swaps empty. Say what the five lacked all the same.');
  return lines;
}

/**
 * What the wider game says about the five lanes we drafted (12 Sep 2026).
 *
 * The one question the review has never been able to answer — was this lane worth taking? — and the
 * answer was already in Firestore, published daily and read by nothing but the draft room. It goes
 * beside the draft rather than beside the game on purpose: it is a fact about a pairing, not about
 * anybody's play, and the block says so twice because a model handed "41%" will otherwise report it
 * as something one of ours did.
 */
function matchupSection(ctx: ReviewContext): string[] {
  return matchupLines(ctx.laneMatchups ?? [], displayChampionName);
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
  // The fights, above the minute-by-minute lines and deliberately so (12 Sep
  // 2026). Those lines spend their forty on the kill list — sixty-three
  // "Fiddlesticks kills Mordekaiser" sentences in the game this was measured on
  // — and a kill list is not a game. This is the same deaths grouped into the
  // fights they happened in, with the two things a coach actually asks: were we
  // a man down when it started, and was the one who opened it behind the player
  // opposite. Both are exact; neither was printed anywhere before this.
  const fights = ctx.recording ? fightLines(ctx.recording, MAX_FIGHT_LINES) : [];
  if (fights.length) {
    lines.push(
      `THE FIGHTS (deaths of ours within ${FIGHT_WINDOW_SEC} seconds of one another are one fight; the count on their side is the kills the client reported within half that window either side, so no kill is counted into two fights)`,
      'Read these as the shape of the game. What is NOT in them is any objective: the League client reports no dragon, no Baron, no herald and no grubs for a custom game, so nothing here can say what fell after a fight. How many fell and whose they were is the tally above and is exact; only the frames can bracket WHEN, and only between two of them.',
      ...fights
    );
  }
  // A recorded custom game (10 Sep 2026): the totals above come from the
  // replay file, the minutes below from the recorder that watched it. Both
  // prompts get the sentences; only the team call gets the frames.
  if (ctx.recordedLines?.length) lines.push('RECORDED FROM THE REPLAY, MINUTE BY MINUTE', ...ctx.recordedLines);
  // The board at each death of ours (11 Sep 2026), beside the minutes above.
  // The recorder reads it two seconds before the death, the way it renders a
  // frame, so this is the one part of the prompt that is exact rather than
  // sampled a minute at a time — and it is also the one place a model would
  // cheerfully invent a cooldown off an item, which is why the block says
  // outright that there are none.
  //
  // Twenty boards is `MAX_DEATH_LINES`, the recorder's own cap, and it stands
  // here: at roughly forty tokens a line that is a thousand against the ten
  // thousand the frames already cost, so it crowds nothing out. A bloodbath
  // past twenty is stored and simply not printed, and the line below says so —
  // a review that read nine deaths in the totals and found six boards under
  // them would otherwise take the gap for the game.
  const boards = ctx.recording ? deathLines(ctx.recording, MAX_DEATH_LINES) : [];
  if (boards.length) {
    const recorded = ctx.recording?.deaths?.length ?? boards.length;
    lines.push(
      'AT EACH DEATH OF OURS, WHAT ALL TEN WERE HOLDING (read off the League client two seconds before the death, as a frame is)',
      'This is items, levels, farm, and who was already on the floor with whatever respawn the client gave — and that is the whole of it. There are no ability cooldowns anywhere in it, for anyone, because a replay does not give them: never say an ability was up or down, and never read one out of an item. A seat holding nothing was holding nothing, and every side here is a seat, never a person.',
      ...(recorded > boards.length ? [`These are the first ${boards.length} of ${recorded} deaths, in time order; the rest were recorded and are not printed here, so do not count our deaths off this block.`] : []),
      ...boards
    );
  }
  if (ctx.tier === 'endOfGame') {
    lines.push(
      ctx.recordedLines?.length
        ? 'TIER: a custom game. Riot has no match and no timeline for it, so the totals are the replay file’s and the minutes are the recorder’s. The minutes carry no team gold and no position of anyone; say "around minute N" and infer nothing finer from them. The attached frames are the exception and are worth reading closely — each one’s top bar carries both teams’ gold at that second, its corner carries the neutral timers for what was up, and its minimap carries where everyone stood.'
        : 'TIER: totals only, from a replay file. There are no minutes, no positions and no per-minute figures; say so where it matters and do not infer timing.'
    );
  }
  return lines;
}

function noteSection(ctx: ReviewContext): string[] {
  return ctx.note ? ['OUR OWN NOTE (written by the team, may be in Afrikaans)', ctx.note] : [];
}

/** The team question, as text the model reads once. The draft block is the team's alone; the player prompt has no draft field. */
export function buildTeamPrompt(ctx: ReviewContext): string {
  return [`TEAM: ${ctx.teamName}`, '', ...gameSection(ctx), '', ...compSection(ctx), '', ...draftSection(ctx), '', ...matchupSection(ctx), '', ...happenedSection(ctx, true), '', ...noteSection(ctx)].join('\n').trim();
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
  return [`TEAM: ${ctx.teamName}`, '', ...gameSection(ctx), '', ...compSection(ctx), '', ...matchupSection(ctx), '', ...happenedSection(ctx, false), '', ...per, '', ...noteSection(ctx)].join('\n').trim();
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

/**
 * One change to our draft with hindsight. The caps (three swaps, three gains,
 * two alternatives, 30 words) live in the descriptions and `draftOf`, never as
 * schema keywords: the API rejects maxItems and friends (structured-output
 * schema limits, 10 Sep 2026).
 *
 * A description here is read by the model AT the field, so it beats the Length paragraph in
 * TEAM_SYSTEM when the two disagree. Both move together or neither does.
 */
const swap = {
  type: 'object',
  properties: {
    seat: { type: 'string', enum: [...ROLES], description: 'The seat of ours the swap is in.' },
    out: { type: 'string', description: 'The champion we played in that seat, exactly as given in OUR PLAYERS.' },
    in: { type: 'string', description: 'The champion to try instead, from CHAMPIONS A SWAP MAY NAME, in a similar role for that seat, a mainstream pick; never one of our own five in this game.' },
    why: { type: 'string', description: 'One sentence of at most 30 words citing the fact and the minute.' },
    gains: { type: 'array', items: { type: 'string', enum: [...DRAFT_GAINS] }, description: 'What the swap buys, at most three.' },
    alternatives: {
      type: 'array',
      items: { type: 'string' },
      description: 'At most two other champions from CHAMPIONS A SWAP MAY NAME that would do the same job in that seat; may be empty.'
    }
  },
  required: ['seat', 'out', 'in', 'why', 'gains', 'alternatives'],
  additionalProperties: false
} as const;

/** Something the five lacked that the game exposed (version 6): a gain from the same list a swap buys, and the fact behind it. */
const gap = {
  type: 'object',
  properties: {
    gain: { type: 'string', enum: [...DRAFT_GAINS], description: 'What the comp was missing.' },
    why: { type: 'string', description: 'One sentence of at most 25 words citing the fact and the minute that showed it.' }
  },
  required: ['gain', 'why'],
  additionalProperties: false
} as const;

const draft = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: 'One sentence on how the comp fit the game that was played.' },
    swaps: { type: 'array', description: 'At most three changes to OUR draft the coach would make with hindsight; empty when the draft held.', items: swap },
    lacked: { type: 'array', description: 'What the five we drafted lacked, at most three, each with one sentence of at most 25 words citing the fact and the minute; empty when the draft held.', items: gap }
  },
  required: ['verdict', 'swaps', 'lacked'],
  additionalProperties: false
} as const;

/**
 * What decided the game, which the panel shows as one glyph and one word above everything else.
 *
 * Required here and optional on the answer: the model is always asked, and `parseTeamReview` falls
 * back to the theme of the first thing to work on when the answer is malformed, so a bad field
 * costs a field rather than a review. `why` is the tip behind the word; the panel prints the
 * standing meaning of the theme when the model wrote none.
 */
const decidedBy = {
  type: 'object',
  description: 'The one thing that decided this game.',
  properties: {
    theme: { type: 'string', enum: [...REVIEW_THEMES], description: 'Which of the seven decided it.' },
    why: { type: 'string', description: 'At most twelve words on why that is the answer, citing a figure.' }
  },
  required: ['theme', 'why'],
  additionalProperties: false
} as const;

export const TEAM_SCHEMA = {
  type: 'object',
  properties: {
    decidedBy,
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
    oneThing: { type: 'string', description: 'The one thing to watch for next game, at most twelve words, a choice not an order' },
    draft
  },
  required: ['decidedBy', 'headline', 'summary', 'workOn', 'keepDoing', 'compVerdict', 'compWhy', 'moments', 'lessons', 'oneThing', 'draft'],
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

/** One change to our draft the coach would make with hindsight; version 5. Mirrored as `ReviewSwap` in the app. */
export interface ReviewSwap {
  seat: LaneRole;
  /** The champion we played in that seat, in our own spelling (Riot's id, as the game carries it). */
  out: string;
  /** The champion to try instead, in Data Dragon's spelling, from the list the prompt offered. */
  in: string;
  /** One sentence citing the fact and the minute. */
  why: string;
  /** What the swap buys, distinct, at most three; may be empty. */
  gains: DraftGain[];
  /** Other champions that would do the same job in that seat, Data Dragon's spelling, distinct, at most two; version 6, absent when none resolved. */
  alternatives?: string[];
}

/** Something the five we drafted lacked, with the fact that showed it; version 6. Mirrored as `ReviewGap` in the app. */
export interface ReviewGap {
  gain: DraftGain;
  /** One sentence citing the fact and the minute. */
  why: string;
}

/** The draft with hindsight; version 5. Mirrored as `ReviewDraft` in the app. */
export interface ReviewDraft {
  /** One sentence on how the five fit the game that was played. */
  verdict: string;
  /** At most two before version 6, three from it; empty when the draft held or no champion list was offered. */
  swaps: ReviewSwap[];
  /** What the comp lacked, distinct gains, at most three; version 6, absent when the draft held or nothing resolved. */
  lacked?: ReviewGap[];
}

export interface TeamReview {
  /**
   * The one thing that decided the game (version 8). Optional on the answer even though the schema
   * requires it: eleven stored reviews predate the field, and a malformed one falls back to the
   * first work-on's theme rather than failing the review.
   */
  decidedBy?: { theme: ReviewTheme; why?: string };
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
  /** The draft with hindsight; absent before version 5 and when the model gave no verdict. */
  draft?: ReviewDraft;
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
  const text = strWords(row.text, textMax);
  const evidence = strWords(row.evidence, 130); // 18 words
  if (!text || !evidence) return null;
  const m = typeof row.minute === 'number' && Number.isFinite(row.minute) ? Math.round(row.minute) : null;
  const minute = m !== null && m >= 0 && m <= Math.max(durationMin, 1) ? m : null;
  const theme = themeOf(row.theme);
  const options = optionsOf(row.options);
  return { text, evidence, minute, ...(theme && { theme }), ...(options && { options }) };
}

/**
 * What decided the game. The model's own answer when it gave a real theme, and the theme of the
 * first thing to work on when it did not — that is already one of the seven and is the nearest
 * honest answer, which is what the panel fell back to for every review before version 8. Nothing
 * at all when there is no theme anywhere, because a blank word reads as a thing that failed.
 */
function decidedByOf(v: unknown, workOn: readonly Evidenced[], ours: ReadonlySet<string>): { theme: ReviewTheme; why?: string } | undefined {
  const row = (v ?? {}) as Record<string, unknown>;
  const theme = themeOf(row.theme) ?? workOn[0]?.theme;
  if (!theme) return undefined;
  // The reason goes through the Riot-id guard, which `headline`, `summary` and `compWhy` do not:
  // this is the largest text on the panel, and a why naming anyone off our five is dropped whole
  // rather than shown. The theme survives, and the panel prints the theme's standing meaning.
  const why = optionNamingOurs(strWords(row.why, 85), ours); // 12 words
  return { theme, ...(why && { why }) };
}

function pointsOf(list: unknown, max: number, durationMin: number): Evidenced[] {
  return Array.isArray(list)
    ? list
        .map((x) => evidencedOf(x, 210, durationMin)) // 30 words
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
    const text = strWords(row.text, 175); // 25 words
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

/**
 * What the five lacked (version 6, 10 Sep 2026): a gain the app knows, once
 * each, at most three, each with the sentence that shows it. A "why" naming
 * anyone off our five by Riot id drops the gap, as it drops a swap; our own
 * tags are cut. Nothing here depends on the champion list, so the gaps survive
 * a review that had none to offer.
 */
function lackedOf(list: unknown, ours: ReadonlySet<string>): ReviewGap[] {
  const out: ReviewGap[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (out.length === 3) break;
    const g = (raw ?? {}) as Record<string, unknown>;
    const gain = g.gain;
    if (!(DRAFT_GAINS as readonly unknown[]).includes(gain) || out.some((x) => x.gain === gain)) continue;
    const why = optionNamingOurs(strWords(g.why, 175), ours); // 25 words
    if (!why) continue;
    out.push({ gain: gain as DraftGain, why });
  }
  return out;
}

/**
 * The draft with hindsight (version 5, 10 Sep 2026): one sentence on the fit,
 * then at most three swaps (two until version 6, the same day) and what the
 * five lacked. A swap is kept only when it is about a seat of ours, names the
 * champion we actually played there, and picks a champion from the list the
 * prompt offered that none of our five played; the model's spelling is
 * re-stamped to ours for "out" and to Data Dragon's for "in", so the app can
 * look both up for art. A swap's alternatives resolve the same way as "in" —
 * the list's spelling, none of our five, not the pick itself, once each, at
 * most two — and a name that fails is dropped alone: the swap stands on its
 * "in". Without the list nothing can be resolved and no swap survives, but the
 * verdict and the gaps still do. Two swaps in one seat keep the first. A "why"
 * naming anyone off our five by Riot id drops the swap, as a lesson's option
 * would; our own tags are cut. No verdict, no draft: a swap without the
 * sentence it hangs on says nothing on the card. Empty alternatives and an
 * empty lacked list are left out rather than stored as [] (10 Sep 2026): the
 * app's mirror declares both optional, and a version 5 document has neither.
 */
function draftOf(v: unknown, ctx: ReviewContext): ReviewDraft | undefined {
  const row = (v ?? {}) as Record<string, unknown>;
  const verdict = strWords(row.verdict, 240);
  if (!verdict) return undefined;
  const ours = new Set(ctx.players.map((p) => norm(p.name)));
  const played = new Map<LaneRole, string>(ctx.players.map((p) => [p.seat, p.champion]));
  // Our five under both spellings: the context carries Riot's id ("MonkeyKing") and the pick comes back as the
  // list's display name ("Wukong"), and the two normalise alike for every champion but Wukong, Nunu & Willump
  // and Renata Glasc (10 Sep 2026, second review).
  const ourChampions = new Set(ctx.players.flatMap((p) => [norm(p.champion), norm(displayChampionName(p.champion))]));
  const offered = new Map((ctx.championNames ?? []).filter((n) => n).map((n) => [norm(n), n]));
  const swaps: ReviewSwap[] = [];
  const seen = new Set<LaneRole>();
  for (const raw of Array.isArray(row.swaps) ? row.swaps : []) {
    if (swaps.length === 3) break;
    const s = (raw ?? {}) as Record<string, unknown>;
    const seat = s.seat as LaneRole;
    const out = played.get(seat);
    if (!out || seen.has(seat)) continue;
    if (typeof s.out !== 'string' || norm(s.out) !== norm(out)) continue;
    const pick = typeof s.in === 'string' ? offered.get(norm(s.in)) : undefined;
    if (!pick || ourChampions.has(norm(pick))) continue;
    const why = optionNamingOurs(strWords(s.why, 210), ours); // 30 words
    if (!why) continue;
    const gains = Array.isArray(s.gains)
      ? (s.gains.filter((g, i, all): g is DraftGain => (DRAFT_GAINS as readonly unknown[]).includes(g) && all.indexOf(g) === i) as DraftGain[]).slice(0, 3)
      : [];
    const alternatives: string[] = [];
    for (const a of Array.isArray(s.alternatives) ? s.alternatives : []) {
      if (alternatives.length === 2) break;
      const other = typeof a === 'string' ? offered.get(norm(a)) : undefined;
      // `offered` re-stamps every spelling to the list's, so an exact `includes` is the dedup.
      if (!other || norm(other) === norm(pick) || ourChampions.has(norm(other)) || alternatives.includes(other)) continue;
      alternatives.push(other);
    }
    seen.add(seat);
    swaps.push({ seat, out, in: pick, why, gains, ...(alternatives.length > 0 && { alternatives }) });
  }
  const lacked = lackedOf(row.lacked, ours);
  return { verdict, swaps, ...(lacked.length > 0 && { lacked }) };
}

/** The team answer, capped and checked; anything without evidence is dropped. */
export function parseTeamReview(value: unknown, ctx: ReviewContext): TeamReview {
  const v = (value ?? {}) as Record<string, unknown>;
  const d = ctx.facts.durationMin;
  const verdict = v.compVerdict === 'as drafted' || v.compVerdict === 'off plan' ? v.compVerdict : 'unclear';
  const headline = str(v.headline, 80).replace(/[.!]+$/, '');
  const oneThing = strWords(v.oneThing, 90);
  const draft = draftOf(v.draft, ctx);
  const workOn = pointsOf(v.workOn, 3, d);
  const decided = decidedByOf(v.decidedBy, workOn, new Set(ctx.players.map((pl) => norm(pl.name))));
  return {
    ...(decided ? { decidedBy: decided } : {}),
    ...(headline ? { headline } : {}),
    summary: strWords(v.summary, 315),
    workOn,
    keepDoing: pointsOf(v.keepDoing, 2, d),
    compVerdict: ctx.comp ? verdict : 'unclear',
    compWhy: strWords(v.compWhy, 175),
    moments: momentsOf(v.moments, d, ctx.players.map((p) => p.seat)),
    lessons: lessonsOf(v.lessons, ctx),
    ...(oneThing ? { oneThing } : {}),
    ...(draft ? { draft } : {})
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
    const strength = evidencedOf(row.strength, 195, ctx.facts.durationMin); // 28 words
    const workOn = evidencedOf(row.workOn, 195, ctx.facts.durationMin);
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
  /** Where the totals came from: Riot's timeline, or a replay file's end-of-game figures. */
  tier: 'timeline' | 'endOfGame';
  /**
   * Whether the local recorder's walk through the replay was read (version 7,
   * 11 Sep 2026): the minute-by-minute lines and the frames of our own game.
   * A replay-tier review with this set is timed after all, and the panel must
   * not call it "totals only"; absent means no recording was found.
   */
  recorded?: boolean;
  trigger: 'manual' | 'auto';
  models: { team: string; players: string };
  compId: string | null;
  compName: string | null;
  expect?: CompExpectation;
  team: TeamReview;
  players: PlayerNote[];
  usage: { team: Usage; players: Usage; costUsd: number; tookMs: number };
}
