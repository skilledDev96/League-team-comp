/**
 * What a recorded custom game carries, and what a review reads off it (10 Sep 2026).
 *
 * Riot's API cannot see a custom game at all: there is no match and no
 * timeline for a tournament or a scrim played in a lobby, and a `.rofl` file
 * gives totals only (see `docs`, `riot-custom-game-data.md`). So those games
 * are recorded locally instead: a script runs beside the League client while
 * it plays the replay, reads the Live Client Data API each second and drives
 * the Replay API to a frame at each death. What it uploads is the shape below,
 * stored at `replayRecordings/{matchId}` with one picture per document at
 * `replayShots/{matchId}__{sec}` — and, on a moment the recorder kept a strip
 * of, one more per second leading into it at `{matchId}__{sec}__{frame}`;
 * `frontend/src/app/models/team.models.ts` mirrors both exactly.
 *
 * What a recording cannot carry, and what nothing here may invent:
 * - **No team gold.** The Live Client gives `currentGold` for the spectated
 *   player alone, so there is no gold figure for either side at any minute.
 * - **No positions.** Nothing in the client's data says where anyone stood;
 *   the only view of the map is the minimap inside a frame, which is a
 *   picture of one moment and approximate by construction.
 * - **No cooldowns** beyond what the spectated player's HUD shows in a frame.
 *
 * Riot's rules hold here as everywhere: the other team is a champion in a
 * seat. No name, no Riot id and no puuid of theirs is stored or shown, and a
 * frame is a picture of our own game.
 *
 * Pure: the types, the sentences a review reads, and the pick of pictures it
 * gets. The recorder is a local script; the reads and the model call live in
 * index.ts.
 */
import { LaneRole } from './lane-read';

/**
 * The recorder's shape version. A bump means it keeps something different, so a stored recording
 * says which recorder made it. Version 3 keeps five pictures on the moments that matter — the
 * moment itself and the eight seconds leading into it, one frame every two — where version 2 kept
 * one; both new keys are optional, so a document written by an older recorder is read exactly as it
 * always was.
 */
export const RECORDER_VERSION = 3;

/** Pictures a review is sent, at most. Eight frames are roughly ten thousand input tokens. */
export const MAX_REVIEW_SHOTS = 8;

/** A picture bigger than this is skipped rather than sent: the base64 payload, which is what goes over the wire. */
export const MAX_SHOT_BYTES = 700 * 1024;

/** Sentences a review reads off a recording, at most; the game has to fit on one screen of prompt. */
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

export type ReplayEventKind = 'kill' | 'objective' | 'tower' | 'inhibitor' | 'first' | 'ace' | 'end';
export type ReplayShotKind = 'death' | 'objective' | 'end';
export type ReplaySide = 'us' | 'them';

/** One of the ten, by seat. `name` is ours only, from the roster's Riot ids; theirs is a champion in a seat and never a name. */
export interface ReplaySeat {
  seat: LaneRole;
  champion: string;
  ours: boolean;
  /** OURS ONLY. Absent on every seat of theirs. */
  name?: string;
  /** The two summoner spells, fixed for a whole game and so kept on the seat. */
  spells?: string[];
  /** The keystone rune, likewise fixed. */
  keystone?: string;
}

/** A player's line at one checkpoint. No gold: the client gives it for the spectated player alone. */
export interface ReplaySampleRow {
  seat: LaneRole;
  cs: number;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  wardScore?: number;
}

/** Where both sides stood at one minute of the game. */
export interface ReplaySample {
  minute: number;
  ours: ReplaySampleRow[];
  /** Theirs, by seat, with no name anywhere. */
  theirs: ReplaySampleRow[];
}

/**
 * One thing that happened, at the second the replay clock showed.
 *
 * `text` is the recorder's own sentence, written to follow "Minute 14: " —
 * "their dragon (infernal)", "Ruan (Top) died to a gank" — because that is how
 * `recordingLines` prints it. `seat` is the seat that did it and `victimSeat`
 * the seat it was done to, on either side; a seat is not a name.
 */
export interface ReplayEvent {
  sec: number;
  kind: ReplayEventKind;
  side: ReplaySide;
  text: string;
  seat?: LaneRole;
  victimSeat?: LaneRole;
  /** The dragon's element, the tower's lane, whatever the kind has more of. */
  subType?: string;
}

/** A frame the recorder took, and the document that holds the picture itself. */
export interface ReplayShotRef {
  sec: number;
  kind: ReplayShotKind;
  /** What the frame is of, in the recorder's words: "Ruan (Top) died in their jungle". */
  label: string;
  /** Ours; the seat the frame is about, when it is about one. */
  seat?: LaneRole;
  /** The `replayShots` document id, `{matchId}__{sec}`. */
  docId: string;
  /**
   * The frames leading into the moment, earliest first: eight seconds before it, then six, four, two.
   * Document ids only — a picture is read one at a time. Absent on a recording that kept a
   * single picture a moment, which is every recording written before 12 Sep 2026 and every
   * moment this run did not think worth a strip.
   */
  runUp?: string[];
}

/** What one player was holding at a death of ours. Their side is a seat, never a name. */
export interface ReplayDeathPlayer {
  seat: LaneRole;
  ours: boolean;
  level: number;
  cs: number;
  /** In slot order, the trinket and control wards included. */
  items: string[];
  /** Only when they were already down; absent means alive, never false. */
  dead?: boolean;
  /** Seconds left on them, when the client said. */
  respawn?: number;
}

/** The board at one death of ours: all ten, by seat. */
export interface ReplayDeathState {
  /** The second the death happened; the board is read two seconds before it, as a frame is. */
  sec: number;
  /** Whose death it was. Always one of ours. */
  seat: LaneRole;
  players: ReplayDeathPlayer[];
}

/** One game as the local recorder saw it (`replayRecordings/{matchId}`; matchId is the replay's own dashed id, e.g. EUW1-7977592156). */
export interface ReplayRecording {
  matchId: string;
  recordedAt: string;
  recorderVersion: number;
  durationSec: number;
  ourSide: 'blue' | 'red';
  /** Ten, ours by seat with a name, theirs a champion in a seat. */
  seats: ReplaySeat[];
  /** One a minute. */
  samples: ReplaySample[];
  events: ReplayEvent[];
  shots: ReplayShotRef[];
  /** What all ten held at each death of ours, newest recorders only. */
  deaths?: ReplayDeathState[];
  bytes: number;
}

/** One picture (`replayShots/{matchId}__{sec}`), kept well under Firestore's 1 MiB cap. A frame of OUR own game. */
export interface ReplayShot {
  matchId: string;
  sec: number;
  /** How many seconds before the moment this frame is; absent or 0 is the moment itself. */
  frame?: number;
  kind: string;
  label: string;
  mediaType: 'image/jpeg';
  width?: number;
  height?: number;
  bytes: number;
  /** base64, with no `data:` prefix. */
  data: string;
}

// ---- The sentences a review reads ---------------------------------------------

/**
 * The minute the replay clock showed. Floor, not round: the recording carries
 * the exact second, so an event at 14:50 belongs to minute 14 the way the
 * clock read it — unlike a Riot timeline, where a frame a minute is all there
 * is and rounding is the honest reading.
 */
function minuteOf(sec: number): number {
  return Math.max(0, Math.floor((Number.isFinite(sec) ? sec : 0) / 60));
}

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
 * champions ("Ornn kills Darius"), and the end names the winner. Everything
 * else — an objective, a tower, an inhibitor, a first, an ace — is a label in
 * the recorder's words with the side beside it in a field, so the line has to
 * say whose it was or the coach cannot read it.
 */
const SIDE_IN_TEXT: readonly ReplayEventKind[] = ['kill', 'end'];

/** Does the recorder's own sentence already say whose it was? Then nothing is added to it. */
const SIDE_WORDS = /\b(we|they|us|them|our|their|ours|theirs)\b/i;

/** "to us" or "to them" names who got the thing, which "ours" alone cannot for a tower: a tower belongs to the side that lost it. */
function whose(event: ReplayEvent, said: string): string {
  if (SIDE_IN_TEXT.includes(event.kind) || SIDE_WORDS.test(said)) return said;
  return `${said}, to ${event.side === 'us' ? 'us' : 'them'}`;
}

/** "11-12", or "12" when the five were level. Null when the recorder sent no number at all, so a checkpoint never reads "NaN". */
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
 * One checkpoint in the facts' own voice. There is no gold here and there
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

function seatLine(seats: readonly ReplaySeat[], ours: boolean): string | null {
  const mine = seats.filter((s) => !!s && s.ours === ours && s.champion);
  if (mine.length === 0) return null;
  const said = mine.map((s) => (ours && s.name ? `${s.seat} ${s.name} on ${s.champion}` : `${s.seat} ${s.champion}`)).join(', ');
  return ours ? `OUR FIVE: ${said}.` : `THEIR FIVE, a champion in a seat: ${said}.`;
}

/**
 * The recording as sentences a review can read, in time order and at most
 * `max` of them.
 *
 * The first line says where they came from, because a coach reading "minute
 * 14" has to know this game was watched rather than fetched — Riot has no data
 * for it. The second says what the recording cannot carry, so nothing invents
 * a gold lead out of a CS count.
 */
export function recordingLines(recording: ReplayRecording, max = MAX_RECORDING_LINES): string[] {
  const head = [
    'This game was recorded from the replay by the team’s own recorder: Riot’s API has no match and no timeline for a custom game, so every minute below was read off the League client while the replay played.',
    'The minutes below carry no team gold — the client gives gold for the spectated player alone — and no position of anyone. Every farm figure in them is the client’s own, and in a replay the client reports farm to the nearest ten: a CS gap under ten is not a gap, so never read one as a lead.',
    'The attached frames carry both, and more: the top bar shows each team’s gold, kills, towers and objectives taken at that second; the panel across the bottom shows all ten players’ items, KDA and CS; the corner shows the neutral timers, which say what was up and what was coming; and the minimap shows where everyone stood. Read what you can see in them, and where a number is not legible say so rather than guess at it.'
  ];
  const seats = recording.seats ?? [];
  const ourSeats = seatLine(seats, true);
  const theirSeats = seatLine(seats, false);
  if (ourSeats) head.push(ourSeats);
  if (theirSeats) head.push(theirSeats);

  const checkpoints = sampleMarks(recording.samples ?? [])
    .map((s) => ({ sec: s.minute * 60, order: 1, line: sampleLine(s) }))
    .filter((row): row is { sec: number; order: number; line: string } => !!row.line);

  const budget = Math.max(0, max - head.length - checkpoints.length);
  const events = (recording.events ?? [])
    .map((e, i) => ({ event: e, i, said: e ? body(e.text) : '' }))
    .filter((row) => !!row.event && Number.isFinite(row.event.sec) && !!row.said)
    .sort((a, b) => rankOf(a.event) - rankOf(b.event) || a.event.sec - b.event.sec || a.i - b.i)
    .slice(0, budget)
    .map(({ event, said }) => ({ sec: event.sec, order: 0, line: `Minute ${minuteOf(event.sec)}: ${stopped(whose(event, said))}` }));

  const inOrder = [...events, ...checkpoints].sort((a, b) => a.sec - b.sec || a.order - b.order).map((row) => row.line);
  return [...head, ...inOrder].slice(0, max);
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
function downSaid(player: ReplayDeathPlayer): string {
  return `${player.seat}${player.respawn ? ` (${Math.round(player.respawn)}s left)` : ''}`;
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
 */
function holeLine(deaths: readonly ReplayEvent[], boards: readonly ReplayDeathState[]): string[] {
  let ours: ReplayDeathPlayer[] = [];
  let theirs: ReplayDeathPlayer[] = [];
  let found = false;
  for (const death of deaths) {
    const players = boardAt(boards, death)?.players ?? [];
    if (!players.length) continue;
    const down = players.filter((p) => p.dead && p.ours && p.seat !== death.victimSeat);
    if (found && down.length <= ours.length) continue;
    found = true;
    ours = down;
    theirs = players.filter((p) => p.dead && !p.ours);
  }
  return [
    ...(ours.length ? [`we were ${count(ours.length)} down at the worst of it: our ${ours.map(downSaid).join(', our ')}`] : []),
    ...(theirs.length ? [`they were ${count(theirs.length)} down: their ${theirs.map(downSaid).join(', their ')}`] : [])
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
function fightLine(deaths: readonly ReplayEvent[], kills: readonly ReplayEvent[], boards: readonly ReplayDeathState[]): string {
  const start = deaths[0].sec;
  const end = deaths[deaths.length - 1].sec;
  const theirs = kills.filter((e) => e.side === 'us' && e.sec >= start - FIGHT_EDGE_SEC && e.sec <= end + FIGHT_EDGE_SEC).length;
  const back = theirs ? `${count(theirs)} of theirs with them` : 'nothing back';
  const who = deaths.map((d) => `our ${d.victimSeat}`).join(', then ');
  const span = Math.max(0, Math.round(end - start));
  const head =
    deaths.length === 1
      ? `${clock(start)} — ${who} fell, ${back}`
      : `${clock(start)} — ${count(deaths.length)} of ours fell ${span ? `inside ${span} seconds` : 'in the same second'}, ${back}: ${who}`;

  const parts: string[] = [];
  parts.push(...holeLine(deaths, boards));
  const first = deaths[0].victimSeat;
  const players = boardAt(boards, deaths[0])?.players ?? [];
  const victim = players.find((p) => p.ours && p.seat === first);
  const rival = players.find((p) => !p.ours && p.seat === first);
  // Printed whether or not there is a gap: "level 14 against their 14" tells a coach the fight was
  // not lost on levels, which is as much of an answer as a four-level hole is.
  if (victim && rival) parts.push(`our ${first} was level ${victim.level} on ${victim.cs} cs against their ${first}’s ${rival.level} and ${rival.cs}`);
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
  return fights
    .map((deaths, i) => ({ deaths, i }))
    .sort((a, b) => b.deaths.length - a.deaths.length || b.deaths[0].sec - a.deaths[0].sec)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.i - b.i)
    .map(({ deaths }) => fightLine(deaths, kills, boards));
}

// ---- The pictures a review gets ------------------------------------------------

/** A Firestore document id we made ourselves: `{matchId}__{sec}`. Anything else is not read, so no path can be walked out of the collection. */
const SAFE_DOC_ID = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Which frames go to the model, at most `max` (the review passes eight).
 *
 * Every death of ours first, in time order, because a death is where a game
 * is decided and the frame is the only view of where everyone stood; then the
 * objectives; then the end. A shot without a document id it could have written
 * is dropped, and the same document is never sent twice.
 *
 * One ref a moment is the shape of `shots` and not a filter written here:
 * `docId` is the picture OF the moment however many frames the recorder kept
 * of it, and the frames leading into it hang off the ref as `runUp`. So this
 * returns what it always returned, and a recording written by a newer recorder
 * reads the same on an api that has not been redeployed.
 *
 * The run-up frames never reach a review, deliberately. A review gets eight
 * pictures, and eight moments tell a coach more than one moment seen five
 * times over; the strip is for the reader in the film room, who can watch a
 * fight start.
 */
export function shotsFor(recording: ReplayRecording, max = MAX_REVIEW_SHOTS): ReplayShotRef[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  const usable = (recording.shots ?? []).filter((s) => !!s && Number.isFinite(s.sec) && typeof s.docId === 'string' && SAFE_DOC_ID.test(s.docId));
  const ofKind = (kind: ReplayShotKind) => usable.filter((s) => s.kind === kind).sort((a, b) => a.sec - b.sec);
  const out: ReplayShotRef[] = [];
  const seen = new Set<string>();
  for (const shot of [...ofKind('death'), ...ofKind('objective'), ...ofKind('end')]) {
    if (out.length >= max) break;
    if (seen.has(shot.docId)) continue;
    seen.add(shot.docId);
    out.push(shot);
  }
  return out;
}
