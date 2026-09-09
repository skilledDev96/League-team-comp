import { AnalysisGame, AnalysisPlayer, GameReview, ReviewPoint } from '../models/team.models';

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

function point(p: ReviewPoint, prefix = ''): string {
  const minute = p.minute !== null ? `[${p.minute} min] ` : '';
  return `${prefix}${minute}${p.text}${p.evidence ? ` (${p.evidence})` : ''}`;
}

/** The review as plain text for Discord: a title line, the points, a line per player. */
export function reviewAsText(review: GameReview, game: AnalysisGame | undefined, opponent?: string): string {
  const title = review.team.headline || firstSentence(review.team.summary) || 'Game review';
  const score = scoreline(game);
  const result = score[0]?.label;
  const kills = score.find((c) => c.label === 'Kills');
  const length = score.find((c) => c.label === 'Length');
  const meta = [result, kills ? `${kills.ours}-${kills.theirs}` : '', length ? `in ${length.ours}` : '', opponent ? `vs ${opponent}` : '']
    .filter(Boolean)
    .join(' ');
  const lines: string[] = [`**${title}**${meta ? ` — ${meta}` : ''}`];
  if (review.team.summary && review.team.headline) lines.push(review.team.summary);
  const [first, ...rest] = review.team.workOn;
  if (first) lines.push('', `**First thing next game:** ${point(first)}`);
  if (rest.length) lines.push('', '**Work on:**', ...rest.map((p) => point(p, '• ')));
  if (review.team.keepDoing.length) lines.push('', '**Keep doing:**', ...review.team.keepDoing.map((p) => point(p, '• ')));
  if (review.players.length) {
    lines.push('', '**Players:**');
    for (const p of review.players) {
      const parts = [];
      if (p.strength.text) parts.push(`+ ${p.strength.text}`);
      if (p.workOn.text) parts.push(`− ${p.workOn.text}`);
      lines.push(`• ${p.name} (${p.seat}, ${p.champion}) — ${parts.join(' / ')}`);
    }
  }
  return lines.join('\n');
}
