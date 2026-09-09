import {
  AnalysisGame,
  AnalysisPlayer,
  DeathVerdict,
  GameFacts,
  GameReview,
  MatchTimeline,
  REVIEW_THEMES,
  ReviewPoint,
  ReviewTheme,
  Role,
  ROLES
} from '../models/team.models';
import { FilmCall, FilmCard, FilmChapter, FilmModel, FilmOneThing, FilmSeat, FilmTitle } from './film-model';
import { askOf, ledgerLine, playerStatLine, scoreline } from './review-view';
import { seedOf, shuffle } from './seed';

/**
 * The film room's model, built once from the review, the analysed game and
 * the timeline (9 Sep 2026). Everything is decided here so the chapters stay
 * templates: which seat the title card shows, the four themes to call, the
 * A/B the first work-on offers, the five Call it back items with their
 * answers. Every draw is seeded by the match id and salted by what it is
 * for, so a film reads the same on every visit and a new item added later
 * never reshuffles an old one. Nothing reads the clock.
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

const VERDICT_WORDS: Record<GameReview['team']['compVerdict'], string> = { 'as drafted': 'As drafted', 'off plan': 'Off plan', unclear: 'Unclear' };

const BLANK_POINT: ReviewPoint = { text: '', evidence: '', minute: null };

const seatIndex = (seat: Role) => ROLES.indexOf(seat);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : text).trim();
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function seatOf(player: AnalysisPlayer): Role | undefined {
  return POSITION_SEAT[player.position];
}

/** Letters only, lowercased, so "Kai'Sa" and "Kaisa" and "KaiSa" agree. */
function letters(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}

/** The seat whose champion the headline names, when it names one of ours. */
function headlineSeat(headline: string, review: GameReview): Role | undefined {
  const words = letters(headline);
  const named = review.players.filter((p) => p.champion && words.includes(letters(p.champion)));
  return named.sort((a, b) => seatIndex(a.seat) - seatIndex(b.seat))[0]?.seat;
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

/** Whole numbers within 2 to 8 of `value`, never below zero, in a seeded order. */
function neighbours(seed: number, value: number, salt: string, count: number): number[] {
  const pool: number[] = [];
  for (let d = 2; d <= 8; d++) {
    if (value - d >= 0) pool.push(value - d);
    pool.push(value + d);
  }
  return shuffle(seed, pool, salt).slice(0, count);
}

/** Every whole number from 0 to `max` except `value`, nearest first, in a seeded order among the nearest; never past `max`, so a count of deaths is never offered more deaths than there were. */
function countNeighbours(seed: number, value: number, max: number, salt: string, count: number): number[] {
  const pool: number[] = [];
  for (let n = 0; n <= max; n++) if (n !== value) pool.push(n);
  const near = pool.sort((a, b) => Math.abs(a - value) - Math.abs(b - value) || a - b).slice(0, count + 2);
  return shuffle(seed, near, salt).slice(0, count);
}

/** A call whose options are shuffled by its key; the answer follows its option. */
function call(seed: number, key: string, question: string, options: string[], answerIndex: number, why: string, theme?: ReviewTheme): FilmCall {
  const order = shuffle(
    seed,
    options.map((_, i) => i),
    key
  );
  const out: FilmCall = { key, question, options: order.map((i) => options[i]), answer: order.indexOf(answerIndex), why };
  if (theme) out.theme = theme;
  return out;
}

function seatLabel(review: GameReview, seat: Role): string {
  const champion = review.players.find((p) => p.seat === seat)?.champion;
  return champion ? `${seat} · ${champion}` : seat;
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

function timelineItems(review: GameReview, timeline: MatchTimeline, facts: GameFacts, seed: number, commit: FilmCall | undefined): FilmCall[] {
  const out: FilmCall[] = [];

  const tower = facts.firsts?.tower ?? timeline.firsts.tower;
  if (tower) {
    const options = [tower.minute, ...neighbours(seed, tower.minute, 'cb:firstTower-distractors', 3)];
    const line = facts.lines.find((l) => /first tower/i.test(l)) ?? `${tower.side === 'us' ? 'We' : 'They'} took the first tower at ${tower.minute} min, ${tower.lane}.`;
    out.push(
      call(
        seed,
        'cb:firstTower',
        'When did the first tower fall?',
        options.map((m) => `${m} min`),
        0,
        line,
        'tempo'
      )
    );
  }

  const summary = facts.ledgerSummary;
  if (summary?.deaths) {
    const options = [summary.dark, ...countNeighbours(seed, summary.dark, summary.deaths, 'cb:dark-distractors', 3)];
    out.push(
      call(
        seed,
        'cb:dark',
        `How many of our ${plural(summary.deaths, 'death', 'deaths')} had no ward nearby?`,
        options.map(String),
        0,
        ledgerLine(summary),
        'vision'
      )
    );
  }

  const lanes = facts.lanes.length ? facts.lanes : timeline.lanes.map((l) => ({ ...l, line: '' }));
  const flipped = lanes.filter((l) => l.flippedAt !== undefined).sort((a, b) => a.flippedAt! - b.flippedAt! || seatIndex(a.seat) - seatIndex(b.seat))[0];
  if (flipped && lanes.length >= 2) {
    const options = lanes.map((l) => l.seat);
    const line = flipped.line || `${flipped.seat} changed hands first, around ${flipped.flippedAt} min.`;
    out.push(
      call(
        seed,
        'cb:flip',
        'Which lane changed hands first?',
        options.map((s) => seatLabel(review, s)),
        options.indexOf(flipped.seat),
        line,
        'lanes'
      )
    );
  }

  if (commit) out.push(commit);

  const involved = new Map<Role, number>();
  let total = 0;
  for (const o of timeline.objectives) {
    if (!o.ourInvolved.length) continue;
    total++;
    for (const seat of o.ourInvolved) involved.set(seat, (involved.get(seat) ?? 0) + 1);
  }
  if (total) {
    const ranked = ROLES.slice().sort((a, b) => (involved.get(b) ?? 0) - (involved.get(a) ?? 0) || seatIndex(a) - seatIndex(b));
    const options = ranked.slice(0, 4);
    const top = ranked[0];
    out.push(
      call(
        seed,
        'cb:objectives',
        'Who was on the most objectives?',
        options.map((s) => seatLabel(review, s)),
        0,
        `${seatLabel(review, top)} was on ${involved.get(top)} of ${plural(total, 'objective', 'objectives')}.`,
        'objectives'
      )
    );
  }

  return out;
}

function killsItem(game: AnalysisGame | undefined, seed: number): FilmCall | undefined {
  if (!game?.kills) return undefined;
  const options = [game.kills.ours, ...neighbours(seed, game.kills.ours, 'cb:kills-distractors', 3)];
  return call(seed, 'cb:kills', 'How many kills did we get?', options.map(String), 0, `Kills ${game.kills.ours}-${game.kills.theirs}.`, 'fights');
}

function gapItem(game: AnalysisGame | undefined, seed: number): FilmCall | undefined {
  const counts = scoreline(game).filter((c) => c.theirs !== undefined && c.label !== 'Kills');
  if (counts.length < 2) return undefined;
  const gaps = counts.map((c) => ({ label: c.label, gap: Math.abs(Number(c.ours) - Number(c.theirs)), text: `${c.label} ${c.ours}-${c.theirs}` }));
  const widest = gaps.slice().sort((a, b) => b.gap - a.gap)[0];
  if (!widest.gap) return undefined;
  const others = shuffle(
    seed,
    gaps.filter((g) => g !== widest),
    'cb:gap-pool'
  ).slice(0, 3);
  const options = [widest, ...others];
  return call(
    seed,
    'cb:gap',
    'Which count was furthest apart?',
    options.map((g) => g.label),
    0,
    `${widest.text}, the widest gap.`,
    'objectives'
  );
}

function kpItem(game: AnalysisGame | undefined, seed: number): FilmCall | undefined {
  const withKp = (game?.players ?? []).filter((p) => p.killParticipation !== undefined);
  if (withKp.length < 2) return undefined;
  const top = withKp.slice().sort((a, b) => b.killParticipation! - a.killParticipation!)[0];
  const others = shuffle(
    seed,
    withKp.filter((p) => p !== top),
    'cb:kp-pool'
  ).slice(0, 3);
  // A game player can carry the Riot tag; a call option shows the name alone.
  const label = (p: AnalysisPlayer) => `${p.name.replace(/#[A-Za-z0-9]{2,5}$/, '')} · ${p.champion}`;
  const options = [top, ...others];
  return call(seed, 'cb:kp', 'Who was in on the most kills?', options.map(label), 0, `${label(top)} was in on ${Math.round(top.killParticipation! * 100)}% of our kills.`, 'fights');
}

function asDraftedItem(review: GameReview, seed: number): FilmCall {
  const verdicts: GameReview['team']['compVerdict'][] = ['as drafted', 'off plan', 'unclear'];
  return call(
    seed,
    'cb:asDrafted',
    'Did the game go as drafted?',
    verdicts.map((v) => VERDICT_WORDS[v]),
    verdicts.indexOf(review.team.compVerdict),
    review.team.compWhy || `The review called it ${review.team.compVerdict}.`,
    'draft'
  );
}

function headlineItem(review: GameReview, headline: string, seed: number): FilmCall | undefined {
  const distractors = sentences(review.team.summary)
    .map((s) => s.replace(/[.!?]+$/, ''))
    .filter((s) => s && s !== headline && s.length <= 120)
    .slice(0, 2);
  if (distractors.length < 1) return undefined;
  return call(seed, 'cb:headline', 'Which line was this game’s headline?', [headline, ...distractors], 0, firstSentence(review.team.summary));
}

/**
 * The commitment item. With an A/B the answer is -1 and the options stay in
 * A, B order, so the page can light the team's choice; with one ask the ask
 * itself is the answer, beside a keep-doing as the distractor.
 */
function commitItem(review: GameReview, oneThing: FilmOneThing, seed: number): FilmCall | undefined {
  const first = review.team.workOn[0];
  if (!first?.text) return undefined;
  const question = 'What did we commit to next game?';
  if (oneThing.options) return { key: 'cb:commit', question, options: [...oneThing.options], answer: -1, why: first.text, theme: first.theme };
  const keep = review.team.keepDoing[0]?.text;
  const options = keep ? [askOf(first.text), askOf(keep)] : [askOf(first.text)];
  return call(seed, 'cb:commit', question, options, 0, first.text, first.theme);
}

function buildCallback(review: GameReview, game: AnalysisGame | undefined, timeline: MatchTimeline | null, oneThing: FilmOneThing, headline: string, seed: number): FilmCall[] {
  const commit = commitItem(review, oneThing, seed);
  const facts = timeline?.facts;
  const items: FilmCall[] = facts && review.tier === 'timeline' ? timelineItems(review, timeline!, facts, seed, commit) : [killsItem(game, seed), gapItem(game, seed), kpItem(game, seed), commit, asDraftedItem(review, seed)].filter((c): c is FilmCall => !!c);
  // Whatever the data could not fill is made up from the review itself, then the game's totals.
  const fallbacks = [headlineItem(review, headline, seed), killsItem(game, seed), asDraftedItem(review, seed), gapItem(game, seed), kpItem(game, seed)];
  for (const item of fallbacks) {
    if (items.length >= 5) break;
    if (item && !items.some((i) => i.key === item.key)) items.push(item);
  }
  return items.slice(0, 5);
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
  { kind: 'callback', title: 'Call it back' },
  { kind: 'card', title: 'The card' }
];

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
    callback: buildCallback(review, game, timeline, oneThing, title.headline, seed),
    card: buildCard(review, game, title.headline)
  };
}

/** Exported for the specs and the page: the ledger rows of one seat, in time order. */
export function deathsFor(ledger: DeathVerdict[] | undefined, seat: Role): DeathVerdict[] {
  return (ledger ?? []).filter((d) => d.seat === seat).sort((a, b) => a.minute - b.minute);
}
