import { DeathCould, DeathHow, DeathVerdict, DraftGain, GameReview, LedgerSummary, MapZone, ReviewPoint, ReviewTheme, Role, TimelineObjective, TimelineWardType } from '../models/team.models';
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
// bottom-left, red base top-right). Since 11 Sep 2026 a death or an objective
// the timeline carries an event position for is drawn where it happened
// (`riotToPercent`); anything else is still a seeded sample inside its zone
// bucket by `core/rift-zones.ts`, approximate by construction. Each mark says
// which through `placed`, and the corner note says it in words.

export type FilmTapeEventKind = 'ourDeath' | 'theirDeath' | 'objective' | 'first' | 'plate' | 'back';

/**
 * How a mark on the Rift got its spot (11 Sep 2026, the lead: "the
 * approximate meters are a bit off, can we tighten that"): `event` is the
 * position the timeline's own kill or monster-kill event carried, which is
 * where it happened; `zone` is the seeded sample inside the zone bucket the
 * film used before, and still uses for a row no event backs. `placementNote`
 * in `core/film-build.ts` turns a screenful of these into the one sentence
 * the map and the tape both print.
 */
export type FilmPlacement = 'event' | 'zone';

export interface FilmTapeEvent {
  sec: number;
  kind: FilmTapeEventKind;
  /** Short, for a tooltip: "Ruan (Top) died", "Their dragon (infernal)", "First blood, ours". */
  label: string;
  side?: 'us' | 'them';
  seat?: Role;
  /**
   * For a death of theirs: our seats that were in on the kill, straight off
   * the timeline's `theirDeaths[].ourInvolved` (11 Sep 2026, second fix pass).
   * The tape's Rift filters its dots by this the way the map chapter filters
   * `FilmMap.theirs[].seats`; without it a seat filter on the tape dropped
   * every dot, so a traded death read as a solo one. Absent on a timeline
   * that kept nobody, and then the dot leaves with the filter, as on the map.
   */
  seats?: Role[];
  champion?: string;
  zone?: MapZone;
  x: number;
  y: number;
  /** The ledger key "d:<minute>:<seat>" for a death of ours, so the map and the notes can find it. */
  key?: string;
  /** Where the spot came from, on the kinds an event can place: the deaths and the objectives. Absent on a first, a plate or a back, which have no position of their own at all and are drawn on the lane or the base. */
  placed?: FilmPlacement;
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
 * moments, the objectives, the fights, the firsts, the turn and every death
 * of ours, in time order. The tape pauses on each with its card (glyph,
 * title, text, the champions it is about, what the gold did next) and plays
 * on after a dwell; nothing here is a question. Since 10 Sep 2026 (the lead
 * asked for the timeline broken down on the deaths) each death is a beat of
 * its own, titled by its read; a death inside a fight, at an objective or
 * in a coach's moment is that beat, which lists it in `deaths`.
 */
export interface FilmBeat {
  /** A stable key: "b:<kind>:<sec>", or the death's ledger key for a death beat. */
  key: string;
  sec: number;
  kind: FilmBeatKind;
  /** Short: "First blood, theirs", "Our infernal dragon", "Fight in the river", "Where it turned", "Ruan falls, avoidable", "Nia falls, bought an objective". */
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
  /** The pin keys of the deaths folded into this beat, in time order (10 Sep 2026): the tape draws each one's tile and read under the card, so a fight still says who fell in it. Absent when none did; never on a death beat itself. */
  deaths?: string[];
}

/** One champion on the Rift at a frame, percent space; theirs carry a champion in a seat, never a name. */
export interface FilmFramePlace {
  seat: Role;
  champion?: string;
  x: number;
  y: number;
}

/**
 * Where the ten stood at one minute (Part C, 10 Sep 2026), in lane order,
 * from `framesOf` in `film-build.ts`; a seat with no position at that frame
 * is left out. `placeAt(frames, sec)` blends the two nearest into one at a
 * fractional minute, so the tape and the lab can stand the ten at any second;
 * approximate by construction, since a frame is a minute apart from the next.
 */
export interface FilmFrame {
  minute: number;
  ours: FilmFramePlace[];
  theirs: FilmFramePlace[];
}

/**
 * A ward of ours on the Rift, from `wardsOf` in `film-build.ts`: from its
 * placing to its end (`untilSec`: killed when the log says, else a control
 * ward stands to the game's end and anything else 90 s), percent space, with
 * its sight radius in percent. `x` and `y` are the placer's spot at the
 * nearest frame, because a ward event carries no position of its own:
 * approximate by a minute, and every surface that draws one says so.
 * `wardsAt(wards, sec)` lists the ones standing at a second.
 */
export interface FilmWard {
  sec: number;
  untilSec: number;
  seat: Role;
  type: TimelineWardType;
  x: number;
  y: number;
  /** Sight radius in percent of the map (about 900 units for a trinket or control ward). */
  r: number;
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
  /** In time order, at most forty (fourteen until 10 Sep 2026, when every death became a beat); what the tape stops on and explains. `railGroups` in `film-build.ts` folds them by minute for the rail. */
  beats: FilmBeat[];
  /** Timeline version 3 only: where the ten stood, once a minute; absent on older documents, and every chapter that draws them says approximate. */
  frames?: FilmFrame[];
  /** Timeline version 3 only: our wards with their sight. */
  wards?: FilmWard[];
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
  /** Where the pin got its spot: 'event' is the kill's own position (timeline version 4), 'zone' the seeded sample inside `zone` the film drew before it. The card and the caption say which. */
  placed: FilmPlacement;
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
  /**
   * Their dots, placed from the kill's own position where the timeline has one
   * (version 4), else by zone; `placed` says which. `seats` are ours the
   * timeline records on the kill, so a seat's view keeps the kills that seat
   * was in on (11 Sep 2026); a kill with none of ours on it leaves under any
   * seat, the way a blob with no seats already did.
   */
  theirs: { x: number; y: number; minute: number; placed: FilmPlacement; seats?: Role[] }[];
  /** The fight blobs; `seats` are ours who fell in it, so the per-champion filter can hide the fights that seat was not in (10 Sep 2026). */
  clusters: { x: number; y: number; r: number; ours: number; theirs: number; line: string; seats?: Role[] }[];
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
 * Review version 6 (10 Sep 2026, the lead asked for more than one swap)
 * adds up to three swaps, a second option or two under each
 * (`alternatives`, Data Dragon spelling like `in`) and what the comp
 * `lacked` as chips; a version 5 review carries neither and the chapter
 * shows the swaps alone.
 */
export interface FilmDraft {
  verdict: string;
  ours: FilmDraftSeat[];
  theirs: FilmDraftSeat[];
  /** At most three; `alternatives` at most two, never the played or the swapped-in champion, absent when the review names none. */
  swaps: { seat: Role; out: string; in: string; why: string; gains: DraftGain[]; glyphs: FilmGlyph[]; alternatives?: string[] }[];
  /** What the comp lacked, as chips above the swaps (review version 6); each with its glyph. */
  lacked?: { gain: DraftGain; glyph: FilmGlyph; why: string }[];
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
