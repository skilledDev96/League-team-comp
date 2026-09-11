import { ReplayDeathPlayer, ReplayDeathState, ReplayEvent, ReplayEventKind, ReplayRecording, ReplaySample, ReplaySampleRow, ReplaySeat } from '../models/team.models';

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
 * Deaths of ours this far apart or less are one fight. Thirty seconds is a long teamfight and a
 * short respawn, and it is what turns a five-man wipe into one line instead of five.
 */
export const FIGHT_WINDOW_SEC = 30;

/**
 * How far either side of a fight a kill of theirs is counted into it. Half the window on purpose:
 * a fight is split from the next by a gap LONGER than the window, so two fights' edges can never
 * reach the same second and no kill is ever counted into both.
 */
const FIGHT_EDGE_SEC = FIGHT_WINDOW_SEC / 2;

/** Fights a prompt reads, at most; the costliest of them, put back in time order. */
export const MAX_FIGHT_LINES = 12;

/**
 * The two sentences that head a recording wherever it is read: where it came
 * from, and what it cannot carry. The prompt prints them; the drawer says the
 * same thing in its own caveat, so it does not print them twice.
 */
export const RECORDING_HEAD: readonly string[] = [
  'This game was recorded from the replay by the team’s own recorder: Riot’s API has no match and no timeline for a custom game, so every minute below was read off the League client while the replay played.',
  'The minutes below carry no team gold — the client gives gold for the spectated player alone — and no position of anyone. Every farm figure in them is the client’s own, and in a replay the client reports farm to the nearest ten: a CS gap under ten is not a gap, so never read one as a lead.',
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

/**
 * A ward tally for a side only when every row on it carries one: a sum of some of the five is not a
 * figure. Rounded to a tenth, because the client keeps a ward score as a float and summing five of
 * them put "wards 191.29999999999998 to 174.8" into a coaching prompt (12 Sep 2026).
 */
function wardTotal(rows: ReplaySampleRow[]): number | null {
  if (!(rows.length > 0 && rows.every((r) => typeof r.wardScore === 'number'))) return null;
  return Math.round(total(rows, (r) => r.wardScore as number) * 10) / 10;
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
const COUNTS: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

/** "three", for the small counts a fight deals in; anything larger is left as a figure. */
function count(n: number): string {
  return COUNTS[n] ?? String(n);
}

/**
 * The replay clock as the client shows it: "24:07". A fight is named to the second, unlike a minute
 * line, because the recording carries the second and a coach scrubbing to a fight needs it.
 */
function clock(sec: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The board read at one death of ours, matched on the second AND the seat. The recorder pushes a
 * death onto its own list in the same pass that writes the kill event, from the same second, so an
 * exact match is right and a tolerant one would attach the wrong board to the later of two deaths
 * a second apart.
 */
function boardAt(boards: readonly ReplayDeathState[], death: ReplayEvent): ReplayDeathState | undefined {
  return boards.find((b) => b.sec === death.sec && b.seat === death.victimSeat);
}

/** Someone on the floor, as the fight line says them: "Mid (25s left)", with the side put on outside. */
function downSaid(player: ReplayDeathPlayer, said: SeatName): string {
  return `${said(player.seat, player.ours)}${player.respawn ? ` (${Math.round(player.respawn)}s left)` : ''}`;
}

/**
 * How a seat is said: OURS BY CHAMPION, THEIRS BY SEAT (12 Sep 2026).
 *
 * The model copies the words it is given, and so does the coach reading the drawer — these
 * sentences are where a review learned to write "our Jungle, ADC and Support were all dead".
 * Naming our own by champion is what a player actually says, and leaving the other side as a bare
 * seat is the Riot rule doing its job rather than fighting it: they have no names here, so a seat
 * word standing alone comes to mean them. A recording written before seats carried champions falls
 * back to "our Top", which is what it always said.
 */
type SeatName = (seat: ReplayEvent['victimSeat'], ours: boolean) => string;

function seatNamer(recording: ReplayRecording): SeatName {
  const mine = new Map<string, string>();
  for (const s of recording.seats ?? []) {
    if (s?.ours && s.seat && s.champion) mine.set(s.seat, s.champion);
  }
  return (seat, ours) => {
    if (!seat) return ours ? 'one of ours' : 'one of theirs';
    return ours ? mine.get(seat) ?? `our ${seat}` : `their ${seat}`;
  };
}

/**
 * The deepest hole we were in at any point of the fight, and who of theirs was on the floor at that
 * same moment, as nothing, one clause or two.
 *
 * Read across **every** death in the fight and not just the first (12 Sep 2026). The first death's
 * board is the state the fight opened in, which for a wipe is five on five and says nothing; the
 * 4v5 a coach is looking for appears a few seconds later, once one of ours is already down and the
 * rest fight on anyway. A fight of five deaths over forty seconds reported "nobody down" off its
 * opening board while the truth was that the last two walked into a four-man deficit.
 *
 * The one who is falling is never counted as already down, whatever their board says: it is read
 * two seconds before them, so counting them would report the fight's own death as the reason for
 * it. Ties go to the earliest moment, and a board the recorder never took (`MAX_DEATH_STATES`, or a
 * recording made before boards existed) is simply skipped rather than read as nobody down.
 *
 * TWO READINGS, NEVER ONE (12 Sep 2026, found by an audit of a real review). Excluding only the
 * player falling on each board was not enough: at 33:05 our five were all alive, and by 33:11 three
 * of them were down — all three killed in that very fight. The deepest hole is true and the review
 * read it as "we took a fight three men down on respawn timers", which is the exact reverse of what
 * happened, and it reached a work-on, a moment, a lesson answer and the one thing. So the line now
 * says both, and each carries its own clock: **how it opened**, counting nobody who falls in this
 * fight however their board reads, and **how deep it got, by what second**. Engaging short and
 * being collapsed on are opposite mistakes and a coach has to be told which one this was.
 */
function holeLine(deaths: readonly ReplayEvent[], boards: readonly ReplayDeathState[], said: SeatName): string[] {
  // Whoever falls in THIS fight is its casualty, never its cause. Their board two seconds before
  // the next death shows them dead, and without this set that is read back as the state we engaged
  // in — which is how a 5v5 that collapsed came out as a fight taken three men down.
  const fell = new Set(deaths.map((d) => d.victimSeat));
  const opening = deaths[0] ? boardAt(boards, deaths[0])?.players ?? [] : [];
  const before = opening.filter((p) => p.dead && p.ours && !fell.has(p.seat));

  let ours: ReplayDeathPlayer[] = [];
  let theirs: ReplayDeathPlayer[] = [];
  let at = 0;
  let found = false;
  for (const death of deaths) {
    const players = boardAt(boards, death)?.players ?? [];
    if (!players.length) continue;
    const down = players.filter((p) => p.dead && p.ours && p.seat !== death.victimSeat);
    if (found && down.length <= ours.length) continue;
    found = true;
    ours = down;
    theirs = players.filter((p) => p.dead && !p.ours);
    at = death.sec;
  }
  return [
    // How it opened, which is the question a coach actually asks. Silent when no board was taken
    // for the first death, because "five up" would then be a guess and not a reading.
    ...(opening.length ? [before.length ? `we opened it ${count(before.length)} down: ${before.map((p) => downSaid(p, said)).join(', ')}` : 'we opened it five up'] : []),
    // How deep it got, WITH THE SECOND IT WAS READ AT, so it can never be re-anchored to the start.
    ...(ours.length ? [`by ${clock(at)} we were ${count(ours.length)} down: ${ours.map((p) => downSaid(p, said)).join(', ')}`] : []),
    ...(theirs.length ? [`by ${clock(at)} they were ${count(theirs.length)} down: ${theirs.map((p) => downSaid(p, said)).join(', ')}`] : [])
  ];
}

/**
 * One fight as a sentence: when it started, what it cost each side, who fell in what order, the
 * deepest hole either side was in while it ran, and how the first of ours to fall stood against the
 * same seat on their side.
 *
 * Why this exists (12 Sep 2026). A recording already carried every figure below and printed none of
 * them: the respawn seconds sat unread on every board, and the prompt's minute-by-minute list spent
 * its forty lines on sixty-three separate "Fiddlesticks kills Mordekaiser" sentences, which is a
 * kill list and not a game. A coach does not ask who killed whom; they ask whether we took that
 * fight a man down, and whether the one who opened it was behind the player opposite. Both answers
 * are exact here.
 *
 * Every figure is measured. The counts are the client's own kill events, the respawn seconds are
 * the client's own, and the levels and farm are the board read two seconds before the death — with
 * the farm carrying the client's own resolution, which in a replay is the nearest ten (measured on
 * a real recording: all six hundred and sixty CS figures in it were multiples of ten, while the
 * ward scores beside them were full floats). So the figures are printed as the client gave them and
 * `RECORDING_HEAD` says outright that a gap under ten is not a gap.
 *
 * What is deliberately NOT here is any objective: the League client emits no dragon, no Baron, no
 * herald and no grub event for a custom game at all — measured against a real recording on 12 Sep
 * 2026, where a hundred raw events held sixty-three champion kills, sixteen towers and not one
 * monster — so "and their Baron followed" cannot be sourced from the events and is not claimed. The
 * frames' own top bar carries those counts, and the review's rules say to bracket an objective
 * between two frames rather than state a minute it cannot support.
 */
function fightLine(deaths: readonly ReplayEvent[], kills: readonly ReplayEvent[], boards: readonly ReplayDeathState[], said: SeatName): string {
  const start = deaths[0].sec;
  const end = deaths[deaths.length - 1].sec;
  const theirs = kills.filter((e) => e.side === 'us' && e.sec >= start - FIGHT_EDGE_SEC && e.sec <= end + FIGHT_EDGE_SEC).length;
  // "nothing back" reads as a recall in League, and the model copies the words it is given: this
  // sentence is where the last review learned to write "20:22 nothing back" (12 Sep 2026).
  const back = theirs ? `${count(theirs)} of theirs with them` : 'and killed nobody in return';
  const who = deaths.map((d) => said(d.victimSeat, true)).join(', then ');
  const span = Math.max(0, Math.round(end - start));
  const head =
    deaths.length === 1
      ? `${clock(start)} — ${who} fell, ${back}`
      // The list of who fell comes before the trade, so the sentence does not run "…in return: our Top".
      : `${clock(start)} — ${count(deaths.length)} of ours fell ${span ? `inside ${span} seconds` : 'in the same second'}: ${who}, ${back}`;

  const parts: string[] = [];
  parts.push(...holeLine(deaths, boards, said));
  const first = deaths[0].victimSeat;
  const players = boardAt(boards, deaths[0])?.players ?? [];
  const victim = players.find((p) => p.ours && p.seat === first);
  const rival = players.find((p) => !p.ours && p.seat === first);
  // Printed whether or not there is a gap: "level 14 against their 14" tells a coach the fight was
  // not lost on levels, which is as much of an answer as a four-level hole is.
  if (victim && rival) parts.push(`${said(first, true)} was level ${victim.level} on ${victim.cs} cs against their ${first}’s ${rival.level} and ${rival.cs}`);
  return `${head}${parts.length ? `; ${parts.join('; ')}` : ''}.`;
}

/**
 * The game's fights, in time order and at most `max` of them.
 *
 * Built from the **kill events** rather than from the boards, so that a death past
 * `MAX_DEATH_STATES` still appears and a recording written before the boards existed still gets its
 * fights — the boards are looked up per fight and add the levels, the farm and the respawns when
 * they are there. Deaths of ours within `FIGHT_WINDOW_SEC` of one another chain into one fight, so
 * a wipe is one line and not five.
 *
 * When there are more fights than `max`, the ones kept are the ones that cost most: the most of
 * ours falling, ties to the later fight, because a four-man wipe at thirty minutes decided more of
 * the game than a solo death at three. They are then put back into time order, which is the order
 * anything reading them expects.
 */
export function fightLines(recording: ReplayRecording, max = MAX_FIGHT_LINES): string[] {
  const kills = (recording.events ?? []).filter((e) => !!e && e.kind === 'kill' && Number.isFinite(e.sec));
  const ourDeaths = kills.filter((e) => e.side === 'them' && !!e.victimSeat).sort((a, b) => a.sec - b.sec);
  const fights: ReplayEvent[][] = [];
  for (const death of ourDeaths) {
    const open = fights[fights.length - 1];
    if (open && death.sec - open[open.length - 1].sec <= FIGHT_WINDOW_SEC) open.push(death);
    else fights.push([death]);
  }
  const boards = (recording.deaths ?? []).filter((b) => !!b && Number.isFinite(b.sec) && Array.isArray(b.players));
  const said = seatNamer(recording);
  return fights
    .map((deaths, i) => ({ deaths, i }))
    .sort((a, b) => b.deaths.length - a.deaths.length || b.deaths[0].sec - a.deaths[0].sec)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.i - b.i)
    .map(({ deaths }) => fightLine(deaths, kills, boards, said));
}
