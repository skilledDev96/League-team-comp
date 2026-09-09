import {
  AnalysisGame,
  AnalysisPlayer,
  DeathVerdict,
  GameFacts,
  GameReview,
  MatchTimeline,
  REVIEW_THEMES,
  ReviewPoint,
  Role,
  ROLES
} from '../models/team.models';
import { mentionedSeat } from './champion-mention';
import { FilmCall, FilmCard, FilmChapter, FilmModel, FilmOneThing, FilmSeat, FilmTitle } from './film-model';
import { askOf, playerStatLine, scoreline } from './review-view';
import { seedOf, shuffle } from './seed';

/**
 * The film room's model, built once from the review, the analysed game and
 * the timeline (9 Sep 2026). Everything is decided here so the chapters stay
 * templates: which seat the title card shows, the four themes to call, the
 * A/B the first work-on offers, the card's asks. Every draw is seeded by the
 * match id and salted by what it is for, so a film reads the same on every
 * visit. Nothing reads the clock.
 */

export interface FilmPrevious {
  review: GameReview;
  game?: AnalysisGame;
  timeline?: MatchTimeline | null;
}

/** Riot's positions and the seat words both appear on `AnalysisPlayer.position`, depending on the source. */
const POSITION_SEAT: Record<string, Role> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Support',
  Top: 'Top',
  Jungle: 'Jungle',
  Mid: 'Mid',
  ADC: 'ADC',
  Support: 'Support'
};

const BLANK_POINT: ReviewPoint = { text: '', evidence: '', minute: null };

const seatIndex = (seat: Role) => ROLES.indexOf(seat);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : text).trim();
}

function seatOf(player: AnalysisPlayer): Role | undefined {
  return POSITION_SEAT[player.position];
}

/** The seat whose champion the headline names as a whole word, when it names one of ours; the first in lane order when it names two. */
function headlineSeat(headline: string, review: GameReview): Role | undefined {
  return mentionedSeat(
    headline,
    review.players.slice().sort((a, b) => seatIndex(a.seat) - seatIndex(b.seat))
  );
}

/**
 * Our MVP by the line: kills and assists over deaths, the share of the team's
 * damage, kill participation. A plain score, the same on every game, so the
 * poster fronts the one who carried rather than the one who died most.
 */
function mvpSeat(game: AnalysisGame): Role | undefined {
  const teamDamage = game.players.reduce((sum, p) => sum + (p.damage ?? 0), 0);
  const scored = game.players
    .map((p) => {
      const seat = seatOf(p);
      const share = teamDamage ? (p.damage ?? 0) / teamDamage : 0;
      const score = p.kills * 3 + p.assists * 1.5 - p.deaths * 2 + share * 12 + (p.killParticipation ?? 0) * 6;
      return { seat, score };
    })
    .filter((p): p is { seat: Role; score: number } => !!p.seat)
    .sort((a, b) => b.score - a.score || seatIndex(a.seat) - seatIndex(b.seat));
  return scored[0]?.seat;
}

/** The seat's player in the analysed game: by position first, then by name, then by champion. */
function gamePlayerFor(game: AnalysisGame | undefined, seat: Role, name: string, champion: string): AnalysisPlayer | undefined {
  if (!game) return undefined;
  return game.players.find((p) => seatOf(p) === seat) ?? game.players.find((p) => p.name === name) ?? game.players.find((p) => p.champion === champion);
}

/**
 * The two choices a work-on offers. "the fact; either X or Y" splits on the
 * either/or; "the fact, so next time X, or Y" splits on the last ", or" with
 * the first choice starting after the last semicolon or ", so". A ", or"
 * before that boundary is part of the fact ("no plates, or dragons, so next
 * time rotate bot") and never a choice. A clause shorter than a phrase or
 * longer than a card means the sentence was not really offering a choice,
 * and the chapter shows one Commit card instead.
 */
export function splitOptions(text: string): [string, string] | undefined {
  const trim = (s: string) =>
    capitalise(
      s
        .trim()
        .replace(/[.!?;,]+$/, '')
        .replace(/^(next time|next game|going forward),?\s+/i, '')
        .trim()
    );
  const ok = (s: string) => s.length >= 8 && s.length <= 120;
  const either = /(?:^|\s)either\s+([\s\S]+?)\s+or\s+([\s\S]+)$/i.exec(text);
  if (either) {
    const a = trim(either[1]);
    const b = trim(either[2]);
    return ok(a) && ok(b) ? [a, b] : undefined;
  }
  const lower = text.toLowerCase();
  const semi = lower.lastIndexOf('; ');
  const so = lower.lastIndexOf(', so ');
  const start = Math.max(semi >= 0 ? semi + 2 : 0, so >= 0 ? so + 5 : 0);
  const orAt = lower.lastIndexOf(', or ');
  if (orAt < start) return undefined;
  const a = trim(text.slice(start, orAt));
  const b = trim(text.slice(orAt + 5));
  return ok(a) && ok(b) ? [a, b] : undefined;
}

function buildTitle(review: GameReview, game: AnalysisGame | undefined, facts: GameFacts | undefined, previous: FilmPrevious | null, opponent: string | undefined, seed: number): FilmTitle {
  const team = review.team;
  const headline = team.headline || firstSentence(team.summary) || 'Game review';
  // A review carries no result of its own; without the game or the facts the card says loss rather than guess.
  const win = game ? game.win : facts ? facts.result === 'win' : false;
  const ledger = facts?.ledger ?? [];

  // The face of the film is our MVP: the champion the headline names when it
  // names one of ours, else the best line of the five (9 Sep 2026: it used to
  // be the seat that died most, which put Vi on a game Aphelios carried).
  let seat: Role | undefined = headlineSeat(headline, review);
  if (!seat && game?.players.length) seat = mvpSeat(game);
  seat ??= review.players[0]?.seat ?? 'Mid';
  const reviewed = review.players.find((p) => p.seat === seat);
  const gamePlayer = game?.players.find((p) => seatOf(p) === seat);
  const protagonist = { seat, champion: reviewed?.champion ?? gamePlayer?.champion ?? '', name: reviewed?.name ?? gamePlayer?.name };

  const first = team.workOn[0];
  let titleCall: FilmCall | undefined;
  if (first?.theme) {
    const taken = new Set(team.workOn.map((w) => w.theme).filter(Boolean));
    const distractors = shuffle(
      seed,
      REVIEW_THEMES.filter((t) => !taken.has(t)),
      'title'
    ).slice(0, 3);
    const options = shuffle(seed, [first.theme, ...distractors], 'title-order');
    // The options are theme ids, not words: the chapter draws each as a chip with its icon.
    titleCall = { key: 'title', question: 'What decided this game?', options: [...options], answer: options.indexOf(first.theme), why: first.text, theme: first.theme };
  }

  const durationMin = game?.durationSec ? Math.round(game.durationSec / 60) : facts?.durationMin;
  const lowerThird: FilmTitle['lowerThird'] = {
    date: game?.date ?? (Date.parse(review.reviewedAt) || 0),
    compName: review.compName,
    compVerdict: team.compVerdict,
    compWhy: team.compWhy,
    tier: review.tier
  };
  if (opponent) lowerThird.opponent = opponent;
  if (durationMin) lowerThird.durationMin = durationMin;
  if (game?.kills) lowerThird.kills = { ours: game.kills.ours, theirs: game.kills.theirs };

  let lastTime: FilmTitle['lastTime'];
  const prevFirst = previous?.review.team.workOn[0];
  if (previous && prevFirst?.text) {
    lastTime = { matchId: previous.review.matchId, text: askOf(prevFirst.text) };
    if (facts?.ledger) {
      if (prevFirst.theme === 'vision') {
        const n = ledger.filter((d) => d.could.includes('ward')).length;
        lastTime.recurrence = `This game: ${plural(n, 'death', 'deaths')} with no ward nearby`;
      } else if (prevFirst.theme === 'macro') {
        const n = ledger.filter((d) => d.could.includes('call')).length;
        lastTime.recurrence = `This game: ${plural(n, 'death', 'deaths')} their jungler was already close for`;
      }
    }
  }

  const title: FilmTitle = { headline, win, protagonist, lowerThird };
  if (titleCall) title.call = titleCall;
  if (lastTime) title.lastTime = lastTime;
  return title;
}

function buildOneThing(review: GameReview): FilmOneThing {
  const { workOn, keepDoing } = review.team;
  const point = workOn[0] ?? BLANK_POINT;
  const out: FilmOneThing = {
    point,
    rest: [...workOn.slice(1).map((p) => ({ kind: 'workOn' as const, point: p })), ...keepDoing.map((p) => ({ kind: 'keepDoing' as const, point: p }))]
  };
  const options = splitOptions(point.text);
  if (options) out.options = options;
  return out;
}

function buildSeats(review: GameReview, game: AnalysisGame | undefined, facts: GameFacts | undefined): FilmSeat[] {
  const ledger = facts?.ledger ?? [];
  return review.players
    .slice()
    .sort((a, b) => seatIndex(a.seat) - seatIndex(b.seat))
    .map((p) => {
      const seat: FilmSeat = {
        seat: p.seat,
        name: p.name,
        champion: p.champion,
        statLine: playerStatLine(gamePlayerFor(game, p.seat, p.name, p.champion)),
        strength: p.strength,
        workOn: p.workOn,
        more: p.more ?? [],
        deaths: deathsFor(ledger, p.seat)
      };
      if (p.seat === 'Jungle' && facts?.presence) {
        seat.presence = { kills: facts.presence.kills, ofKills: facts.presence.ofKills, line: facts.presence.line };
      }
      return seat;
    });
}

function buildCard(review: GameReview, game: AnalysisGame | undefined, headline: string): FilmCard {
  const first = review.team.workOn[0];
  const card: FilmCard = {
    headline,
    scoreline: scoreline(game),
    oneThing: first?.text ? askOf(first.text) : '',
    asks: review.players
      .slice()
      .sort((a, b) => seatIndex(a.seat) - seatIndex(b.seat))
      .filter((p) => p.workOn.text)
      .map((p) => ({ name: p.name, seat: p.seat, champion: p.champion, ask: askOf(p.workOn.text) }))
  };
  const keep = review.team.keepDoing[0]?.text;
  if (keep) card.keepDoing = keep;
  return card;
}

const CHAPTERS: FilmChapter[] = [
  { kind: 'title', title: 'The game' },
  { kind: 'one-thing', title: 'The one thing' },
  { kind: 'seat', title: 'Your seat' },
  { kind: 'card', title: 'The card' }
];

/** How many chapters a film has, for a line written before the model is built (the games row). */
export const FILM_CHAPTER_COUNT = CHAPTERS.length;

export function buildFilm(review: GameReview, game: AnalysisGame | undefined, timeline: MatchTimeline | null, previous: FilmPrevious | null, opponent?: string): FilmModel {
  const seed = seedOf(review.matchId);
  const facts = timeline?.facts;
  const title = buildTitle(review, game, facts, previous, opponent, seed);
  const oneThing = buildOneThing(review);
  return {
    matchId: review.matchId,
    tier: review.tier,
    seed,
    chapters: CHAPTERS.map((c) => ({ ...c })),
    title,
    oneThing,
    seats: buildSeats(review, game, facts),
    card: buildCard(review, game, title.headline)
  };
}

/** Exported for the specs and the page: the ledger rows of one seat, in time order. */
export function deathsFor(ledger: DeathVerdict[] | undefined, seat: Role): DeathVerdict[] {
  return (ledger ?? []).filter((d) => d.seat === seat).sort((a, b) => a.minute - b.minute);
}
