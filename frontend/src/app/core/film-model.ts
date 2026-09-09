import { DeathCould, DeathHow, DeathVerdict, GameReview, LedgerSummary, MapZone, ReviewPoint, ReviewTheme, Role } from '../models/team.models';
import { ScoreChip } from './review-view';

/**
 * What the film room shows, chapter by chapter, built once from the review,
 * the analysed game and the timeline by `film-build.ts` (9 Sep 2026). The
 * page and every chapter component read this and nothing else about the
 * game; the live parts — the team's commitment, the notes, a person's
 * progress — come from the services, because they change while the film
 * plays.
 *
 * A "call" is a question the reader answers before the reveal: the options
 * in the order shown, the index of the right one, and the line shown after.
 */

export type FilmChapterKind = 'title' | 'one-thing' | 'seat' | 'card' | 'tape' | 'board' | 'map';

export interface FilmChapter {
  kind: FilmChapterKind;
  /** The kicker at the top of the chapter. */
  title: string;
}

export interface FilmCall {
  /** A stable key the progress is stored under ("title", "seat:Jungle"). */
  key: string;
  question: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
  /** Shown after the reveal, right or wrong: the fact's own line. */
  why: string;
  theme?: ReviewTheme;
}

export interface FilmProtagonist {
  seat: Role;
  champion: string;
  name?: string;
}

export interface FilmTitle {
  headline: string;
  win: boolean;
  protagonist: FilmProtagonist;
  /** "What decided this game?" — present only when the first work-on carries a theme. Options are themes. */
  call?: FilmCall;
  lowerThird: {
    date: number;
    opponent?: string;
    durationMin?: number;
    kills?: { ours: number; theirs: number };
    compName: string | null;
    compVerdict: GameReview['team']['compVerdict'];
    compWhy: string;
    tier: GameReview['tier'];
  };
  /** The previous review's one thing, and whether it came back this game. */
  lastTime?: { matchId: string; text: string; recurrence?: string };
}

export interface FilmOneThing {
  point: ReviewPoint;
  /** The two choices the sentence offers, when it does; else a single Commit card. */
  options?: [string, string];
  /** The other work-ons and the keep-doings, opened on tap. */
  rest: { kind: 'workOn' | 'keepDoing'; point: ReviewPoint }[];
}

export interface FilmSeat {
  seat: Role;
  name: string;
  champion: string;
  statLine: string;
  strength: ReviewPoint;
  workOn: ReviewPoint;
  more: ReviewPoint[];
  /** This seat's deaths from the ledger, in time order; empty on the replay tier. */
  deaths: DeathVerdict[];
  /** The jungler on our kills; Jungle only, timeline tier only. */
  presence?: { kills: number; ofKills: number; line: string };
}

export interface FilmCard {
  headline: string;
  scoreline: ScoreChip[];
  /** "Watch for it next game": the first work-on's ask. */
  oneThing: string;
  asks: { name: string; seat: Role; champion: string; ask: string }[];
  keepDoing?: string;
}

// ---- Slice 2: the tape, the board, the map ------------------------------------
//
// Positions are percent-space on the Rift image (0-100 both axes, blue base
// bottom-left, red base top-right), placed inside the zone bucket the timeline
// put them in by `core/rift-zones.ts`. Approximate by construction, and every
// surface that shows them says so.

export type FilmTapeEventKind = 'ourDeath' | 'theirDeath' | 'objective' | 'first' | 'plate' | 'back';

export interface FilmTapeEvent {
  sec: number;
  kind: FilmTapeEventKind;
  /** Short, for a tooltip: "Ruan (Top) died", "Their dragon (infernal)", "First blood, ours". */
  label: string;
  side?: 'us' | 'them';
  seat?: Role;
  champion?: string;
  zone?: MapZone;
  x: number;
  y: number;
  /** The ledger key "d:<minute>:<seat>" for a death of ours, so the map and the notes can find it. */
  key?: string;
}

export interface FilmMoment {
  minute: number;
  text: string;
  swing: 'us' | 'them' | 'even';
  /** What the gold did over the next three minutes: "Over the next three minutes: -1.4k". */
  consequence?: string;
}

/** A call the tape pauses for, a game-minute before the thing happens. */
export interface FilmTapeCall extends FilmCall {
  /** When the hand pauses. */
  atSec: number;
  /** When the answer shows on the map. */
  revealSec: number;
}

export interface FilmTape {
  durationSec: number;
  ourSide: 'blue' | 'red';
  /** Index is the minute; ours minus theirs. */
  goldDiff: number[];
  /** Where it turned: the worst deficit on a loss, the biggest lead on a win, the earliest lane flip on a swing. */
  turn: { minute: number; why: string } | null;
  moments: FilmMoment[];
  /** In time order. */
  events: FilmTapeEvent[];
  calls: FilmTapeCall[];
}

/** The replay tier's static board: the counts, with one call before they show. */
export interface FilmBoard {
  tallies: { label: string; ours: number; theirs: number }[];
  /** "Which count was furthest apart?" over the tallies; null when every count is tied. */
  call: FilmCall | null;
  moments: FilmMoment[];
}

export interface FilmDeathPin {
  key: string;
  sec: number;
  minute: number;
  seat: Role;
  name?: string;
  champion?: string;
  zone: MapZone;
  x: number;
  y: number;
  how: DeathHow;
  could: DeathCould[];
  /** The ledger's line. */
  line: string;
}

export interface FilmMap {
  /** In the order the chapter walks them. */
  pins: FilmDeathPin[];
  theirs: { x: number; y: number; minute: number }[];
  clusters: { x: number; y: number; r: number; ours: number; theirs: number; line: string }[];
  summary: LedgerSummary;
  /** "How many of our N deaths had no ward nearby?" as a slider: the answer and the slider's top. */
  darkCall: { answer: number; max: number };
  order: 'chronological' | 'worst-first';
}

export interface FilmModel {
  matchId: string;
  tier: GameReview['tier'];
  seed: number;
  chapters: FilmChapter[];
  title: FilmTitle;
  oneThing: FilmOneThing;
  seats: FilmSeat[];
  card: FilmCard;
  /** Timeline tier only. */
  tape?: FilmTape;
  /** Replay tier only. */
  board?: FilmBoard;
  /** Timeline tier with a ledger only. */
  map?: FilmMap;
}
