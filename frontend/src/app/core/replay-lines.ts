import { ReplayDeathState, ReplayEvent, ReplayEventKind, ReplayRecording, ReplaySample, ReplaySampleRow, ReplaySeat } from '../models/team.models';

/**
 * A recorded game in sentences (10 Sep 2026).
 *
 * A tournament or scrim game is invisible to Riot's API — no match, no
 * timeline — so the local recorder walks the replay in the League client and
 * writes `replayRecordings/{matchId}` instead. These are the sentences read
 * off it: the review's prompt gets them from `api/src/replay-recording.ts`,
 * and the "How the game went" drawer gets them from here.
 *
 * **The two copies are a deliberate mirror**, exactly like `compareCurve` in
 * `core/comp-expectation.ts`: the same input must give the same sentences on
 * both sides, because a coach reading the drawer and a model reading the
 * prompt must be reading the same game. Change one and change the other;
 * `recordingLines` here returns what `recordingLines` there returns, line for
 * line. The split into `RECORDING_HEAD`, the seat lines and
 * `recordingStory` only lets the drawer show the part it needs — the page
 * says where the game came from in its own words, so it does not print the
 * prompt's preamble back at the reader.
 *
 * What a recording cannot carry, and what nothing here may invent: **no team
 * gold** (the Live Client gives `currentGold` for the spectated player
 * alone), **no positions** except what an attached frame shows, and no
 * cooldowns. What it does carry per seat is CS, levels, the kill tally and
 * sometimes a ward score, which is what the checkpoints are built from.
 */

/** Sentences read off a recording, at most; the game has to fit on one screen. */
export const MAX_RECORDING_LINES = 40;

/** Checkpoint lines, at most: one every five minutes thins to this many. */
export const MAX_SAMPLE_LINES = 5;

/** How many death boards reach a prompt. The rest are stored and simply not printed. */
export const MAX_DEATH_LINES = 20;

/**
 * The two sentences that head a recording wherever it is read: where it came
 * from, and what it cannot carry. The prompt prints them; the drawer says the
 * same thing in its own caveat, so it does not print them twice.
 */
export const RECORDING_HEAD: readonly string[] = [
  'This game was recorded from the replay by the team’s own recorder: Riot’s API has no match and no timeline for a custom game, so every minute below was read off the League client while the replay played.',
  'The minutes below carry no team gold — the client gives gold for the spectated player alone — and no position of anyone.',
  'The attached frames carry both, and more: the top bar shows each team’s gold, kills, towers and objectives taken at that second; the panel across the bottom shows all ten players’ items, KDA and CS; the corner shows the neutral timers, which say what was up and what was coming; and the minimap shows where everyone stood. Read what you can see in them, and where a number is not legible say so rather than guess at it.'
];

const WORDS: Record<number, string> = {
  5: 'five',
  10: 'ten',
  15: 'fifteen',
  20: 'twenty',
  25: 'twenty-five',
  30: 'thirty',
  35: 'thirty-five',
  40: 'forty',
  45: 'forty-five',
  50: 'fifty',
  55: 'fifty-five',
  60: 'sixty'
};

function spell(minute: number): string {
  return WORDS[minute] ?? String(minute);
}

/**
 * The minute the replay clock showed. Floor, not round: the recording carries
 * the exact second, so an event at 14:50 belongs to minute 14 the way the
 * clock read it.
 */
function minuteOf(sec: number): number {
  return Math.max(0, Math.floor((Number.isFinite(sec) ? sec : 0) / 60));
}

/** The recorder's words as one line, capped, with a trailing full stop taken off: the side marker goes on before it. */
function body(text: string, max = 200): string {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .slice(0, max)
    .trim();
}

function stopped(line: string): string {
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

/**
 * Kinds whose sentence already names who it happened to: a kill names both
 * champions, and the end names the winner. Everything else is a label in the
 * recorder's words with the side beside it in a field, so the line has to say
 * whose it was or it cannot be read.
 */
const SIDE_IN_TEXT: readonly ReplayEventKind[] = ['kill', 'end'];

/** Does the recorder's own sentence already say whose it was? Then nothing is added to it. */
const SIDE_WORDS = /\b(we|they|us|them|our|their|ours|theirs)\b/i;

/** "to us" or "to them" names who got the thing, which "ours" alone cannot for a tower: a tower belongs to the side that lost it. */
function whose(event: ReplayEvent, said: string): string {
  if (SIDE_IN_TEXT.includes(event.kind) || SIDE_WORDS.test(said)) return said;
  return `${said}, to ${event.side === 'us' ? 'us' : 'them'}`;
}

/** "11-12", or "12" when the five were level. Null when no number came at all, so a checkpoint never reads "NaN". */
function range(values: number[]): string | null {
  const real = values.filter((v) => Number.isFinite(v));
  if (real.length === 0) return null;
  const low = Math.min(...real);
  const high = Math.max(...real);
  return low === high ? String(low) : `${low}-${high}`;
}

function total(rows: ReplaySampleRow[], pick: (r: ReplaySampleRow) => number): number {
  return rows.reduce((sum, r) => sum + (Number.isFinite(pick(r)) ? pick(r) : 0), 0);
}

/** A ward tally for a side only when every row on it carries one: a sum of some of the five is not a figure. */
function wardTotal(rows: ReplaySampleRow[]): number | null {
  return rows.length > 0 && rows.every((r) => typeof r.wardScore === 'number') ? total(rows, (r) => r.wardScore as number) : null;
}

/**
 * One checkpoint in the recorder's own voice. There is no gold here and there
 * cannot be: what the five had is CS, levels, the kill tally and, when every
 * one of them carries it, the ward tally — the word "score" never reaches a screen in this app (11 Sep 2026).
 */
function sampleLine(sample: ReplaySample): string | null {
  const ours = sample.ours ?? [];
  const theirs = sample.theirs ?? [];
  if (ours.length === 0 || theirs.length === 0) return null;
  const ourLevels = range(ours.map((r) => r.level));
  const theirLevels = range(theirs.map((r) => r.level));
  const bits = [
    `our five had ${total(ours, (r) => r.cs)} CS to their ${total(theirs, (r) => r.cs)}`,
    ...(ourLevels && theirLevels ? [`levels ${ourLevels} against ${theirLevels}`] : []),
    `kills ${total(ours, (r) => r.kills)}-${total(theirs, (r) => r.kills)}`
  ];
  const ourWards = wardTotal(ours);
  const theirWards = wardTotal(theirs);
  if (ourWards !== null && theirWards !== null) bits.push(`wards ${ourWards} to ${theirWards}`);
  return `At ${spell(sample.minute)} minutes: ${bits.join(', ')}.`;
}

/**
 * The checkpoints worth printing: one every five minutes, thinned from the
 * front when the game ran long, so the last one is always the closest to the
 * end.
 */
function sampleMarks(samples: readonly ReplaySample[], max = MAX_SAMPLE_LINES): ReplaySample[] {
  const marks = samples.filter((s) => s && Number.isFinite(s.minute) && s.minute > 0 && s.minute % 5 === 0).sort((a, b) => a.minute - b.minute);
  if (marks.length <= max) return marks;
  const every = Math.ceil(marks.length / max);
  // From the end, so the last checkpoint of the game always survives.
  return marks.filter((_, i) => (marks.length - 1 - i) % every === 0).slice(-max);
}

/**
 * Which events survive when there are more than the cap allows. The end, the
 * firsts and the objectives are the spine of a game; our deaths are what a
 * review is for; our kills and the towers go first, because the totals already
 * say how many there were.
 */
function rankOf(event: ReplayEvent): number {
  switch (event.kind) {
    case 'end':
      return 0;
    case 'first':
      return 1;
    case 'objective':
      return 2;
    case 'inhibitor':
      return 3;
    case 'ace':
      return 4;
    case 'kill':
      return event.side === 'them' ? 5 : 6;
    default:
      return 7;
  }
}

/** Our five and theirs, as one line each; theirs is a champion in a seat and never a name. */
export function recordingSeatLines(recording: ReplayRecording | null | undefined): string[] {
  const seats: readonly ReplaySeat[] = recording?.seats ?? [];
  const line = (ours: boolean): string | null => {
    const mine = seats.filter((s) => !!s && s.ours === ours && s.champion);
    if (mine.length === 0) return null;
    const said = mine.map((s) => (ours && s.name ? `${s.seat} ${s.name} on ${s.champion}` : `${s.seat} ${s.champion}`)).join(', ');
    return ours ? `OUR FIVE: ${said}.` : `THEIR FIVE, a champion in a seat: ${said}.`;
  };
  return [line(true), line(false)].filter((l): l is string => !!l);
}

/**
 * The game itself: every event the recorder saw and every checkpoint, in time
 * order, inside the same budget the prompt gets — the head takes its share
 * first, so these are the very lines `recordingLines` ends with.
 */
export function recordingStory(recording: ReplayRecording | null | undefined, max = MAX_RECORDING_LINES): string[] {
  if (!recording) return [];
  const head = RECORDING_HEAD.length + recordingSeatLines(recording).length;
  const checkpoints = sampleMarks(recording.samples ?? [])
    .map((s) => ({ sec: s.minute * 60, order: 1, line: sampleLine(s) }))
    .filter((row): row is { sec: number; order: number; line: string } => !!row.line);

  const budget = Math.max(0, max - head - checkpoints.length);
  const events = (recording.events ?? [])
    .map((e, i) => ({ event: e, i, said: e ? body(e.text) : '' }))
    .filter((row) => !!row.event && Number.isFinite(row.event.sec) && !!row.said)
    .sort((a, b) => rankOf(a.event) - rankOf(b.event) || a.event.sec - b.event.sec || a.i - b.i)
    .slice(0, budget)
    .map(({ event, said }) => ({ sec: event.sec, order: 0, line: `Minute ${minuteOf(event.sec)}: ${stopped(whose(event, said))}` }));

  return [...events, ...checkpoints].sort((a, b) => a.sec - b.sec || a.order - b.order).map((row) => row.line);
}

/**
 * The recording as sentences, in time order and at most `max` of them: the
 * two head sentences, our five and theirs, then the game.
 *
 * The mirror of `recordingLines` in `api/src/replay-recording.ts` — same
 * input, same lines, same order. Keep the two identical.
 */
export function recordingLines(recording: ReplayRecording | null | undefined, max = MAX_RECORDING_LINES): string[] {
  if (!recording) return [];
  return [...RECORDING_HEAD, ...recordingSeatLines(recording), ...recordingStory(recording, max)].slice(0, max);
}

/**
 * One death of ours as a sentence: what the player who fell was holding when they fell, and who was
 * already on the floor at that moment.
 *
 * Why this exists (11 Sep 2026): the lead asked whether to run the recorder once per seat to get
 * each champion's HUD in a frame. Ability cooldowns are pixels only — the Live Client's
 * `activeplayer` answers 400 in a replay, there being no active player to ask — but the items, the
 * levels, the farm and the respawn timers are in the per-player list for all ten at once. One run
 * therefore reads the board at every death, where a frame per seat would have cost five more runs
 * and could still only reach the eight frames a review reads.
 *
 * It takes one death and nothing else so that a caller with its own reason to pick and order the
 * deaths — the film's strip walks the moments the recorder kept pictures of — asks for the sentence
 * of the death it is holding. Zipping `deathLines` against a caller's own sorted copy by index
 * would land every sentence on the wrong death the moment one filter differed between them.
 */
export function deathLine(death: ReplayDeathState): string {
  // `deathLines` drops a board the recorder never filled before it maps, but a caller walking its
  // own moments has done no such filtering, and a board with no players must read as a bare
  // sentence rather than throw in the middle of building a film.
  const players = death.players ?? [];
  const victim = players.find((p) => p.ours && p.seat === death.seat);
  const parts: string[] = [];
  if (victim) {
    parts.push(`holding ${victim.items?.length ? victim.items.join(', ') : 'nothing'}`);
    parts.push(`level ${victim.level}, ${victim.cs} cs`);
  }
  const down = players
    .filter((p) => p.dead)
    .map((p) => `${p.ours ? 'our' : 'their'} ${p.seat}${p.respawn ? ` (${Math.round(p.respawn)}s left)` : ''}`);
  if (down.length) parts.push(`already down: ${down.join(', ')}`);
  return `Minute ${minuteOf(death.sec)}: our ${death.seat} fell${parts.length ? `, ${parts.join('; ')}` : ''}.`;
}

/**
 * The deaths a prompt reads, earliest first and at most `max` of them; the rest are stored and
 * simply not printed. Every sentence is `deathLine`'s, so the prompt and the film's strip cannot
 * print the same death two different ways.
 */
export function deathLines(recording: ReplayRecording, max = MAX_DEATH_LINES): string[] {
  return (recording.deaths ?? [])
    .filter((d) => !!d && Number.isFinite(d.sec) && Array.isArray(d.players))
    .slice()
    .sort((a, b) => a.sec - b.sec)
    .slice(0, Math.max(0, max))
    .map(deathLine);
}
