import { DeathVerdict, GameReview, ReviewPoint, ReviewTheme, Role } from '../models/team.models';
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

export interface FilmModel {
  matchId: string;
  tier: GameReview['tier'];
  seed: number;
  chapters: FilmChapter[];
  title: FilmTitle;
  oneThing: FilmOneThing;
  seats: FilmSeat[];
  card: FilmCard;
}
