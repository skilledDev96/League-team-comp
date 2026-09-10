import { DeathCould, DeathHow, DeathVerdict, DraftGain, GameReview, LedgerSummary, MapZone, ReviewPoint, ReviewTheme, Role, TimelineObjective } from '../models/team.models';
import { DeathReadKind } from './death-reads';
import { FilmStyle } from './film-style';
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

export type FilmChapterKind = 'title' | 'one-thing' | 'seat' | 'card' | 'tape' | 'board' | 'map' | 'draft';

/**
 * The film's own glyphs (cut 4, 10 Sep 2026): hand-drawn 24×24 SVG paths in
 * `shared/film/film-glyph.component.ts`, one per name, in currentColor. They
 * carry the imagery a death card, a tape beat and a draft swap explain with,
 * so no chapter reaches for a Material icon to say "no ward here".
 */
export type FilmGlyph =
  | 'ward'
  | 'ward-off'
  | 'jungler'
  | 'jungler-far'
  | 'horn'
  | 'footsteps'
  | 'tower'
  | 'dragon'
  | 'baron'
  | 'herald'
  | 'grubs'
  | 'atakhan'
  | 'swords'
  | 'skull'
  | 'shield'
  | 'wall'
  | 'fist'
  | 'coin'
  | 'swap'
  | 'flag'
  | 'eye'
  | 'blood'
  | 'bolt'
  | 'poke'
  | 'sustain'
  | 'split'
  | 'wave'
  | 'hook'
  | 'wind'
  | 'check';

/** The glyph for each gain a draft swap buys. */
export const GAIN_GLYPHS: Record<DraftGain, FilmGlyph> = {
  engage: 'fist',
  peel: 'shield',
  frontline: 'wall',
  poke: 'poke',
  sustain: 'sustain',
  splitpush: 'split',
  waveclear: 'wave',
  pick: 'hook',
  disengage: 'wind',
  damage: 'bolt'
};

/** The glyph for each tag on a death that could have been stopped. */
export const COULD_GLYPHS: Record<DeathCould, FilmGlyph> = {
  ward: 'ward-off',
  jungle: 'jungler-far',
  call: 'horn',
  position: 'footsteps'
};

/** The glyph for each objective. */
export const OBJECTIVE_GLYPHS: Record<TimelineObjective['type'], FilmGlyph> = {
  dragon: 'dragon',
  herald: 'herald',
  grubs: 'grubs',
  baron: 'baron',
  elder: 'dragon',
  atakhan: 'atakhan'
};

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
  /** The same deaths as the map reads them, in time order, when the film has a map. */
  pins?: FilmDeathPin[];
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
  /** The seats of ours the moment is about: the map lights their tokens while the hand pauses here. */
  seats?: Role[];
}

export type FilmBeatKind = 'first' | 'objective' | 'fight' | 'moment' | 'turn' | 'death';

/**
 * A beat the tape stops on and explains (cut 4, 10 Sep 2026): the coach's
 * moments, the objectives, the fights, the firsts, the turn and the
 * costliest avoidable deaths, in time order. The tape pauses on each with
 * its card (glyph, title, text, the champions it is about, what the gold
 * did next) and plays on after a dwell; nothing here is a question.
 */
export interface FilmBeat {
  /** A stable key: "b:<kind>:<sec>", or the death's ledger key for a death beat. */
  key: string;
  sec: number;
  kind: FilmBeatKind;
  /** Short: "First blood, theirs", "Our infernal dragon", "Fight in the river", "Where it turned", "Ruan falls, avoidable". */
  title: string;
  /** The line under it: the facts' own line, the moment's sentence, the death's read. */
  text: string;
  swing: 'us' | 'them' | 'even';
  glyph: FilmGlyph;
  /** The seats of ours it is about, at most three. */
  seats?: Role[];
  /** Our champions in those seats, for the tiles on the card. */
  champions?: string[];
  /** What the gold did over the next three minutes, as the moments carry it. */
  consequence?: string;
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
  /** In time order, at most fourteen; what the tape stops on and explains. */
  beats: FilmBeat[];
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
  /** How the film reads this death (`core/death-reads.ts`): avoidable, traded, bought an objective, or clean. */
  read: DeathReadKind;
  /** One line in the read's own words: "Avoidable: no ward had gone down nearby and two came in." / "Traded one for one in the river." / "Bought the infernal dragon at minute 19." / "Clean: nothing on the map would have stopped this one." */
  readLine: string;
  /** The imagery for the card and the pin's badges, most telling first; at most three. */
  glyphs: FilmGlyph[];
  /** Ours minus theirs over the two minutes after, in gold; negative when it cost us. Absent when the curve does not reach. */
  cost?: number;
  /** What the death scene draws (`shared/film/death-scene.component.ts`). */
  scene: FilmDeathScene;
}

/** What was around a death of ours, for the scene that explains it. Everything approximate by a minute, like the flags it comes from. */
export interface FilmDeathScene {
  could: DeathCould[];
  /** How many came in. */
  killers: number;
  executed: boolean;
  /** Of ours within a screen. */
  alliesNear?: number;
  /** Our jungler at the nearest frame: their champion and the zone they were in. Absent for the jungler's own deaths. */
  ourJungler?: { champion?: string; zone?: MapZone; far: boolean };
  /** Their jungler: the champion (a champion in a seat, never a name) and whether they were already on this side a minute before. */
  theirJungler?: { champion?: string; close: boolean };
  /** An objective within the window: which, and whether it ended up ours. */
  objective?: { type: TimelineObjective['type']; ours: boolean };
  /** How many of theirs fell in the same fight (within the trade window). */
  traded: number;
  /** A ward of ours had gone down nearby. */
  warded: boolean;
}

export interface FilmMap {
  /** In the order the chapter walks them. */
  pins: FilmDeathPin[];
  theirs: { x: number; y: number; minute: number }[];
  clusters: { x: number; y: number; r: number; ours: number; theirs: number; line: string }[];
  summary: LedgerSummary;
  /** How many deaths fall under each read. */
  reads: Record<DeathReadKind, number>;
  /** One line over the map: "11 deaths: 6 avoidable, 2 traded, 1 bought a dragon, 2 clean." */
  opening: string;
  /** The keys of the deaths that cost most (avoidable, by `cost`), at most three, costliest first. */
  costliest: string[];
  order: 'chronological' | 'worst-first';
}

/** A seat in the draft chapter: ours carry a name, theirs a champion only. */
export interface FilmDraftSeat {
  seat: Role;
  champion: string;
  name?: string;
}

/**
 * The draft with hindsight (cut 4, 10 Sep 2026): our five and theirs, the
 * coach's verdict on the fit, and the swaps to try, each with why and what
 * it buys. `variantName` is what Save as a variant would call the comp.
 */
export interface FilmDraft {
  verdict: string;
  ours: FilmDraftSeat[];
  theirs: FilmDraftSeat[];
  swaps: { seat: Role; out: string; in: string; why: string; gains: DraftGain[]; glyphs: FilmGlyph[] }[];
  compId: string | null;
  compName: string | null;
  variantName: string | null;
}

export interface FilmModel {
  matchId: string;
  tier: GameReview['tier'];
  seed: number;
  /** How this film looks and moves, drawn from the seed and the result (`core/film-style.ts`). */
  style: FilmStyle;
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
  /** Review version 5 and later, when the coach wrote a draft verdict. */
  draft?: FilmDraft;
  /** The review's lessons (version 4) as calls, keyed "lesson:<index>", options in a seeded order; absent when the review has none. */
  lessons?: FilmCall[];
}
