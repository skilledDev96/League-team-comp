import { AnalysisGame, AnalysisPlayer, GameReview } from '../models/team.models';

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

/**
 * The review as a short Discord message (9 Sep 2026): a heading, one
 * scoreline in subtext, the first thing next game in full, the first Keep
 * doing, and the ask per player — no evidence, no summary. The full review
 * with the figures stays on the Games page, and the last line says so.
 */
export function reviewAsText(review: GameReview, game: AnalysisGame | undefined, opponent?: string): string {
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
  const first = review.team.workOn[0];
  if (first) lines.push('', `**🎯 First thing next game**${first.theme ? ` · ${first.theme}` : ''}`, first.text);
  const keep = review.team.keepDoing[0];
  if (keep) lines.push('', `**✅ Keep doing**${keep.theme ? ` · ${keep.theme}` : ''}`, keep.text);
  const asks = review.players.filter((p) => p.workOn.text);
  if (asks.length) {
    lines.push('', '**👥 One ask each**');
    for (const p of asks) lines.push(`• **${p.name}** (${p.champion}) — ${askOf(p.workOn.text)}`);
  }
  lines.push('', '-# The full review, with the figures behind every line, is on the Games page.');
  return lines.join('\n');
}
