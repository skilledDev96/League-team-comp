import { AnalysisGame, AnalysisPlayer, DeathCould, DeathHow, DraftGain, GameReview, LedgerSummary, MapZone, ReviewDraft, ReviewTheme, Role } from '../models/team.models';
import type { FilmGlyph } from './film-model';
import { DeathReadKind, readsLine } from './death-reads';

/**
 * The review panel's read side (9 Sep 2026): the scoreline every point
 * refers to, the evidence split into figures, a player's stat line, and the
 * whole review as text for the team chat. Pure, so the panel stays a
 * template.
 */

export interface ScoreChip {
  label: string;
  ours: string;
  theirs?: string;
  /** True when ours is the better side, false when theirs is; absent when it is not a contest. */
  good?: boolean;
}

/** Result, length, kills and the objectives, ours first. Nothing for a game the analysis no longer carries. */
export function scoreline(game: AnalysisGame | undefined): ScoreChip[] {
  if (!game) return [];
  const out: ScoreChip[] = [{ label: game.win ? 'Win' : 'Loss', ours: '', good: game.win }];
  if (game.durationSec) out.push({ label: 'Length', ours: `${Math.round(game.durationSec / 60)} min` });
  const pair = (label: string, ours: number | undefined, theirs: number | undefined) => {
    if (ours === undefined || theirs === undefined) return;
    out.push({ label, ours: String(ours), theirs: String(theirs), good: ours === theirs ? undefined : ours > theirs });
  };
  pair('Kills', game.kills?.ours, game.kills?.theirs);
  const o = game.objectives;
  if (o) {
    pair('Towers', o.ours.towers, o.theirs.towers);
    pair('Dragons', o.ours.dragons, o.theirs.dragons);
    pair('Barons', o.ours.barons, o.theirs.barons);
    pair('Grubs', o.ours.grubs, o.theirs.grubs);
    pair('Heralds', o.ours.heralds, o.theirs.heralds);
  }
  return out;
}

/** Where a review read the game, and whether it has minutes behind it. */
export interface ReviewSource {
  tag: string;
  tip: string;
  /** True when the review's moments and minutes are real, so the strip shows minute pills rather than dots. */
  timed: boolean;
}

/**
 * Which of the three roads a review came down (11 Sep 2026).
 *
 * `tier` says where the totals came from, and it used to be the only answer
 * on the stored review — so a game the local recorder had walked minute by
 * minute, with eight frames of the map attached, came back labelled "Totals
 * only, nothing here is timed" and drew a dot where each minute should have
 * been. `GameReview.recorded` (review version 7) is the missing half. A
 * review written before it has neither the field nor a recording behind it,
 * so the old answer is still the right one for it.
 */
export function reviewSource(review: GameReview | undefined): ReviewSource {
  if (review?.tier === 'timeline') return { tag: 'From the timeline', tip: "Read from Riot's minute-by-minute timeline", timed: true };
  if (review?.recorded) {
    return {
      tag: 'From the recorder',
      tip: 'Read from the replay recorder: the League client walked the replay a minute at a time and took a frame at each death',
      timed: true
    };
  }
  return { tag: 'Totals only', tip: 'A replay carries end-of-game totals only; nothing here is timed', timed: false };
}

/** Half a pill's width plus a hair, as a percentage of the track. Two moments closer than this collide. */
export const MOMENT_MIN_GAP = 9;
/** The track's first and last usable centre, so a pill never hangs off either end. */
const TRACK_LO = 3;
const TRACK_HI = 97;

/**
 * Where each moment sits along the game, as a percentage (12 Sep 2026).
 *
 * A row of evenly spaced pills says a game had six moments. A track says *when* — three of them in
 * the last eight minutes reads as a game that was fine until it was not, which is the shape a coach
 * is looking for and the one the flex row threw away.
 *
 * Exact placement collides, so the two passes push neighbours apart and then pull the tail back
 * inside the track, which keeps the order and the rough shape while guaranteeing a readable gap.
 * Returns nothing for a game with no length and nothing for a single moment — a lone pill on a
 * track is a dot on a line, and the row says the same thing more honestly.
 */
export function momentTrack(minutes: number[], durationSec: number | undefined): number[] {
  const n = minutes.length;
  if (n < 2 || !durationSec || durationSec < 60) return [];
  // More pills than the track can hold at a readable gap: spacing them evenly is the honest answer.
  if ((n - 1) * MOMENT_MIN_GAP > TRACK_HI - TRACK_LO) {
    return minutes.map((_, i) => TRACK_LO + ((TRACK_HI - TRACK_LO) * i) / (n - 1));
  }
  const gameMinutes = durationSec / 60;
  const pos = minutes.map((m) => Math.min(TRACK_HI, Math.max(TRACK_LO, (m / gameMinutes) * 100)));
  for (let i = 1; i < n; i += 1) pos[i] = Math.max(pos[i], pos[i - 1] + MOMENT_MIN_GAP);
  // The push can run the tail off the end. Pin the last to the track and pull the rest back from
  // it, rather than clamping each in place — clamping stacked the last two on the same pixel, which
  // is exactly the collision the gap exists to prevent. The guard above is what makes this fit.
  if (pos[n - 1] > TRACK_HI) {
    pos[n - 1] = TRACK_HI;
    for (let i = n - 2; i >= 0; i -= 1) pos[i] = Math.min(pos[i], pos[i + 1] - MOMENT_MIN_GAP);
  }
  return pos;
}

/**
 * The evidence as figures. The prompt asks for "Leona 1/9/7 · kills 14-35";
 * older reviews wrote sentences with commas, so a split that gives one piece
 * or more than six leaves the line whole rather than chip a sentence.
 */
export function evidenceChips(evidence: string): string[] {
  const text = evidence.trim();
  if (!text) return [];
  const parts = text
    .split(/\s*[·;]\s*|,\s+(?=[A-Za-z0-9])/)
    .map((p) => p.trim().replace(/\.$/, ''))
    .filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 ? parts : [text];
}

/** `3/8/3 · 218 CS · vision 29 · 43% KP`, leaving out what the game does not carry. */
export function playerStatLine(player: AnalysisPlayer | undefined): string {
  if (!player) return '';
  const bits = [`${player.kills}/${player.deaths}/${player.assists}`, `${player.cs} CS`];
  if (player.visionScore !== undefined) bits.push(`vision ${player.visionScore}`);
  if (player.killParticipation !== undefined) bits.push(`${Math.round(player.killParticipation * 100)}% KP`);
  return bits.join(' · ');
}

function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : text).trim();
}

/**
 * The actionable clause of a note. The model writes "the fact; either X or Y"
 * or "the fact, so next time X": the part after the last semicolon or the
 * last ", so" is the ask, and the team chat wants the ask.
 *
 * `maxChars` is OPTIONAL and off by default, and that is load-bearing (12 Sep 2026). A sentence
 * carrying neither marker comes through whole — up to the validator's 320 characters — which is too
 * long for the review panel and exactly right for the Discord message and the Before-you-play
 * reminder. Four of the five callers want it uncapped, so the cap is the caller's to ask for and
 * every existing call site is byte-identical without it.
 */
export function askOf(text: string, maxChars = 0): string {
  const t = text.trim();
  const semi = t.lastIndexOf('; ');
  const so = t.lastIndexOf(', so ');
  let ask = semi >= 0 ? t.slice(semi + 2) : so >= 0 ? t.slice(so + 5) : t;
  ask = ask.replace(/^(next time|next game|going forward),?\s+/i, '').trim();
  const said = ask ? ask[0].toUpperCase() + ask.slice(1) : t;
  if (!maxChars || said.length <= maxChars) return said;
  // On a word boundary, never mid-word: a clause cut at "posi" reads as a bug rather than a trim.
  const cut = said.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

const OBJECTIVE_EMOJI: Record<string, string> = { Towers: '🏰', Dragons: '🐉', Barons: '🟣', Grubs: '🐛', Heralds: '👁️' };

/** The ledger's words on the panel and in the chat (9 Sep 2026). */
export const COULD_LABELS: Record<DeathCould, { label: string; icon: string; tip: string }> = {
  jungle: { label: 'Jungle pathing', icon: 'alt_route', tip: 'Our jungler was about a screen away at the nearest frame and not on an objective' },
  ward: { label: 'A ward', icon: 'visibility_off', tip: 'Two or more came in and no ward of ours had gone down nearby' },
  call: { label: 'A call', icon: 'campaign', tip: 'Their jungler was already on this side of the map a minute before' },
  position: { label: 'Position', icon: 'person_pin_circle', tip: 'On their side of the map with none of ours near' }
};
export const HOW_LABELS: Record<DeathHow, string> = { executed: 'Tower or monster', solo: 'One of them', gank: 'Gank', fight: 'Fight' };
export const ZONE_LABELS: Record<MapZone, string> = {
  ourBase: 'our base',
  theirBase: 'their base',
  top: 'top lane',
  mid: 'mid lane',
  bot: 'bot lane',
  river: 'the river',
  ourJungle: 'our jungle',
  theirJungle: 'their jungle'
};

/**
 * What a swap buys as a phrase: "for the peel", "for peel and engage", "for peel, engage and frontline";
 * empty when the review named no gain. One helper so the panel and the card read the same (10 Sep 2026).
 */
export function gainsPhrase(gains: readonly DraftGain[] | undefined): string {
  const words = (gains ?? []).map((g) => GAIN_LABELS[g]?.toLowerCase()).filter((w): w is string => !!w);
  if (!words.length) return '';
  if (words.length === 1) return `for the ${words[0]}`;
  return `for ${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The other champions a swap could name, as one phrase in the coach's order: "or Braum, or Alistar"; empty when the
 * review named none (review version 6, 10 Sep 2026). One helper so the draft chapter, the card, the panel and the chat
 * read the same. Blank entries are dropped, so a hand-edited document with an empty string never prints "or ".
 */
export function alternativesPhrase(alternatives: readonly string[] | undefined): string {
  return (alternatives ?? [])
    .map((a) => (typeof a === 'string' ? a.trim() : ''))
    .filter(Boolean)
    .map((a) => `or ${a}`)
    .join(', ');
}

/**
 * The seven themes as the film's own glyphs (12 Sep 2026).
 *
 * `lanes`, `tempo` and `macro` had no glyph until this: the panel reached for a Material icon for
 * those three, which is the exact collision the film glyphs exist to prevent — Material Symbols are
 * the app's chrome, the thirty hand-drawn glyphs are its content imagery. Three were drawn rather
 * than borrowing `flag` twice, because a theme that shares a glyph with another is a theme a reader
 * cannot tell apart at a glance, which is the whole point of showing one.
 */
export const THEME_GLYPHS: Record<ReviewTheme, FilmGlyph> = {
  draft: 'swap',
  lanes: 'lane',
  fights: 'swords',
  objectives: 'flag',
  vision: 'eye',
  tempo: 'clock',
  macro: 'map'
};

/** The word under the glyph. Upper-cased by the view, so these stay ordinary nouns. */
export const THEME_WORDS: Record<ReviewTheme, string> = {
  draft: 'Draft',
  lanes: 'Lanes',
  fights: 'Fights',
  objectives: 'Objectives',
  vision: 'Vision',
  tempo: 'Tempo',
  macro: 'Macro'
};

/** What each theme means as the thing that decided a game; NOT `GLYPH_TIPS`, whose sentences are death-scene semantics. */
const DECIDED_TIPS: Record<ReviewTheme, string> = {
  draft: 'The five picked, more than how they were played',
  lanes: 'The lanes — who won their matchup and who lost it',
  fights: 'The fights, won or thrown',
  objectives: 'Dragons, Barons and towers',
  vision: 'What each side could see',
  tempo: 'Who moved first, and when',
  macro: 'The map — waves, rotations and where the pressure was'
};

/**
 * What decided the game, as one glyph and one word — the first thing the panel shows.
 *
 * Review version 8 asks the model for it outright. Before that, the nearest honest answer is the
 * theme of the first thing to work on, which is already one of the seven. When there is neither —
 * a review with no work-ons, or one whose point carries no theme, since `ReviewPoint.theme` is
 * optional — this answers `undefined` and the panel shows no row at all. A blank glyph over an
 * empty word is worse than nothing: it reads as a thing that failed to load.
 */
export function decidedByOf(review: GameReview | undefined): { glyph: FilmGlyph; word: string; tip: string } | undefined {
  // The cast is gone (12 Sep 2026): `decidedBy` is a field on the model now that review version 8
  // writes it, so the shape is checked rather than asserted.
  const named = review?.team?.decidedBy;
  const theme = named?.theme ?? review?.team?.workOn?.[0]?.theme;
  if (!theme || !THEME_GLYPHS[theme]) return undefined;
  return {
    glyph: THEME_GLYPHS[theme],
    word: THEME_WORDS[theme],
    // The model's own sentence when it wrote one; the standing meaning otherwise.
    tip: (named?.why ?? '').trim() || DECIDED_TIPS[theme]
  };
}

/** What a swap in the draft buys, in the team's words (10 Sep 2026); one table for the chapter, the panel and the chat. */
export const GAIN_LABELS: Record<DraftGain, string> = {
  engage: 'Engage',
  peel: 'Peel',
  frontline: 'Frontline',
  poke: 'Poke',
  sustain: 'Sustain',
  splitpush: 'Split push',
  waveclear: 'Wave clear',
  pick: 'Pick',
  disengage: 'Disengage',
  damage: 'Damage'
};


/**
 * Riot's positions and the seat words both appear on `AnalysisPlayer.position`, depending on the source.
 *
 * Moved here from `film-build.ts` on 12 Sep 2026 so the review panel and the film pair a player with
 * a seat by the SAME rule. It was module-private there, and the panel's My-seat view needs exactly
 * it — a second copy is how the film and the panel end up naming different players for one seat.
 */
export const POSITION_SEAT: Record<string, Role> = {
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

export function seatOf(player: AnalysisPlayer): Role | undefined {
  return POSITION_SEAT[player.position];
}

/** The seat's player in the analysed game: by position first, then by name, then by champion. */
export function gamePlayerFor(game: AnalysisGame | undefined, seat: Role, name: string, champion: string): AnalysisPlayer | undefined {
  if (!game) return undefined;
  return game.players.find((p) => seatOf(p) === seat) ?? game.players.find((p) => p.name === name) ?? game.players.find((p) => p.champion === champion);
}

/** `💀 11 deaths · 6 with no ward nearby · 3 with the jungle a screen away`, or nothing without deaths. */
export function ledgerLine(summary: LedgerSummary | undefined): string {
  if (!summary?.deaths) return '';
  const bits = [
    `💀 ${summary.deaths} ${summary.deaths === 1 ? 'death' : 'deaths'}`,
    summary.ganks ? `${summary.ganks} to ${summary.ganks === 1 ? 'a gank' : 'ganks'}` : '',
    summary.dark ? `${summary.dark} with no ward nearby` : '',
    summary.inReach ? `${summary.inReach} with the jungle a screen away` : '',
    summary.alone ? `${summary.alone} alone on their side` : ''
  ].filter(Boolean);
  return bits.join(' · ');
}

/** What the film room adds to the chat message: its own link, what the team committed to, the team's notes. */
export interface ReviewTextExtras {
  /** The film room's URL; printed as the last line, under the Games link. */
  filmLink?: string;
  /** The commitment as the team chose it; printed under the scoreline. */
  commitment?: string;
  /** Team notes, one line each, after the asks; the caller prefixes each with who wrote it, "(RH) text". */
  notes?: string[];
  /** The film's reads of our deaths (`core/death-reads.ts`); when given, the deaths line is theirs rather than the ledger's counts. */
  reads?: Record<DeathReadKind, number>;
  /** The draft with hindsight (review version 5): one Draft line per swap, or the verdict alone when the draft held; since version 6 the swap's other options in brackets and one Lacked line after the swaps. */
  draft?: ReviewDraft;
  /** The display name for a champion however it was spelt (`UiService.championName`): a swap's `out` is Riot's id and its `in` Data Dragon's name, and one sentence must not mix "Wukong for MonkeyKing". */
  championName?: (name: string) => string;
}

/** The reads as the chat's deaths line: "💀 11 deaths: 6 avoidable, 2 traded, 1 bought an objective, 2 clean.", or nothing without deaths. */
function readsSubtext(reads: Record<DeathReadKind, number>): string {
  const total = Object.values(reads).reduce((n, c) => n + (c ?? 0), 0);
  return total ? `💀 ${readsLine(reads)}` : '';
}

/**
 * "Nautilus (or Braum, or Alistar) for Leona (Peel, Pick): why" per swap, or the verdict alone when the coach would
 * change nothing; then, when the review says what the comp lacked (version 6, 10 Sep 2026), one line of the gaps in
 * lower case with the fact behind each: "Lacked: frontline (Ornn was the only tank); peel (...)". The why's own full
 * stop comes off inside the brackets, so the line reads as one sentence; a gap whose gain the table does not know is
 * dropped rather than printed as a code.
 */
function draftLines(draft: ReviewDraft | undefined, championName: (name: string) => string = (name) => name): string[] {
  if (!draft) return [];
  const swaps = (draft.swaps ?? []).filter((s) => s.in && s.out);
  const lines = swaps.length
    ? swaps.map((s) => {
        const gains = (s.gains ?? []).map((g) => GAIN_LABELS[g]).filter(Boolean);
        const alts = alternativesPhrase(s.alternatives);
        return `-# Draft: ${s.in}${alts ? ` (${alts})` : ''} for ${championName(s.out)}${gains.length ? ` (${gains.join(', ')})` : ''}: ${s.why}`;
      })
    : draft.verdict?.trim()
      ? [`-# Draft: ${draft.verdict.trim()}`]
      : [];
  const lacked = (draft.lacked ?? [])
    .filter((g) => g && GAIN_LABELS[g.gain])
    .map((g) => {
      const why = (g.why ?? '').trim().replace(/\.$/, '');
      return `${GAIN_LABELS[g.gain].toLowerCase()}${why ? ` (${why})` : ''}`;
    });
  if (lacked.length) lines.push(`-# Lacked: ${lacked.join('; ')}`);
  return lines;
}

/**
 * The review as a short Discord message (9 Sep 2026): a heading, one
 * scoreline in subtext, the first thing next game in full, the first Keep
 * doing, and the ask per player — no evidence, no summary. The death ledger
 * adds one line of subtext when the timeline carries it, and the commitment
 * one more. The full review with the figures stays on the Games page, and
 * the last lines say so, with the film room after it when there is one.
 * Since 10 Sep 2026 the deaths line is the film's reads when the caller has
 * them, and the draft with hindsight adds a Draft line per swap after the
 * asks (the swap's other options in brackets) and a Lacked line when the
 * review says what the comp was missing (version 6).
 */
export function reviewAsText(review: GameReview, game: AnalysisGame | undefined, opponent?: string, link?: string, ledger?: LedgerSummary, extras?: ReviewTextExtras): string {
  const title = review.team.headline || firstSentence(review.team.summary) || 'Game review';
  const score = scoreline(game);
  const result = score[0];
  const kills = score.find((c) => c.label === 'Kills');
  const length = score.find((c) => c.label === 'Length');
  const bits = [
    result ? `${result.good ? '✅' : '❌'} ${result.label}${kills ? ` ${kills.ours}–${kills.theirs}` : ''}` : '',
    length ? length.ours : '',
    opponent ? `vs ${opponent}` : '',
    ...score.filter((c) => OBJECTIVE_EMOJI[c.label] && c.theirs !== undefined).map((c) => `${OBJECTIVE_EMOJI[c.label]} ${c.ours}–${c.theirs}`)
  ].filter(Boolean);
  const lines: string[] = [`## ${title}`];
  if (bits.length) lines.push(`-# ${bits.join(' · ')}`);
  const deaths = extras?.reads ? readsSubtext(extras.reads) : ledgerLine(ledger);
  if (deaths) lines.push(`-# ${deaths}`);
  const committed = extras?.commitment?.trim();
  if (committed) lines.push(`-# We committed to: ${committed}`);
  const first = review.team.workOn[0];
  if (first) lines.push('', `**🎯 First thing next game**${first.theme ? ` · ${first.theme}` : ''}`, first.text);
  const keep = review.team.keepDoing[0];
  if (keep) lines.push('', `**✅ Keep doing**${keep.theme ? ` · ${keep.theme}` : ''}`, keep.text);
  const asks = review.players.filter((p) => p.workOn.text);
  if (asks.length) {
    lines.push('', '**👥 One ask each**');
    for (const p of asks) lines.push(`• **${p.name}** (${p.champion}) — ${askOf(p.workOn.text)}`);
  }
  const draft = draftLines(extras?.draft, extras?.championName);
  if (draft.length) lines.push('', ...draft);
  const notes = (extras?.notes ?? []).map((n) => n.trim()).filter(Boolean);
  if (notes.length) lines.push('', ...notes.map((n) => `-# Note ${n}`));
  // Angle brackets keep Discord from unfurling the link into an embed.
  lines.push('', link ? `-# Full review with the figures: <${link}>` : '-# The full review, with the figures behind every line, is on the Games page.');
  if (extras?.filmLink) lines.push(`-# Watch the film room: <${extras.filmLink}>`);
  return lines.join('\n');
}
