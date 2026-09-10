import { AnalysisGame, AnalysisPlayer, DeathCould, DeathHow, DraftGain, GameReview, LedgerSummary, MapZone, ReviewDraft } from '../models/team.models';
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
 */
export function askOf(text: string): string {
  const t = text.trim();
  const semi = t.lastIndexOf('; ');
  const so = t.lastIndexOf(', so ');
  let ask = semi >= 0 ? t.slice(semi + 2) : so >= 0 ? t.slice(so + 5) : t;
  ask = ask.replace(/^(next time|next game|going forward),?\s+/i, '').trim();
  return ask ? ask[0].toUpperCase() + ask.slice(1) : t;
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
  /** The draft with hindsight (review version 5): one Draft line per swap, or the verdict alone when the draft held. */
  draft?: ReviewDraft;
  /** The display name for a champion however it was spelt (`UiService.championName`): a swap's `out` is Riot's id and its `in` Data Dragon's name, and one sentence must not mix "Wukong for MonkeyKing". */
  championName?: (name: string) => string;
}

/** The reads as the chat's deaths line: "💀 11 deaths: 6 avoidable, 2 traded, 1 bought an objective, 2 clean.", or nothing without deaths. */
function readsSubtext(reads: Record<DeathReadKind, number>): string {
  const total = Object.values(reads).reduce((n, c) => n + (c ?? 0), 0);
  return total ? `💀 ${readsLine(reads)}` : '';
}

/** "Nautilus for Leona (Peel, Pick): why" per swap, or the verdict alone when the coach would change nothing. */
function draftLines(draft: ReviewDraft | undefined, championName: (name: string) => string = (name) => name): string[] {
  if (!draft) return [];
  const swaps = (draft.swaps ?? []).filter((s) => s.in && s.out);
  if (swaps.length) {
    return swaps.map((s) => {
      const gains = (s.gains ?? []).map((g) => GAIN_LABELS[g]).filter(Boolean);
      return `-# Draft: ${s.in} for ${championName(s.out)}${gains.length ? ` (${gains.join(', ')})` : ''}: ${s.why}`;
    });
  }
  const verdict = draft.verdict?.trim();
  return verdict ? [`-# Draft: ${verdict}`] : [];
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
 * asks.
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
