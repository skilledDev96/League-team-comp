import { AnalysisGame, CompPerformance } from '../../models/team.models';

export type VerdictTone = 'good' | 'warn' | 'neutral';

/** Keep / work-on / drop signal for a comp from its win rate and sample size. */
export function compVerdict(perf: CompPerformance): { label: string; tone: VerdictTone } {
  if (perf.games < 3) return { label: 'Low sample', tone: 'neutral' };
  if (perf.winRate >= 60) return { label: 'Keep', tone: 'good' };
  if (perf.winRate < 40) return { label: 'Drop', tone: 'warn' };
  return { label: 'Work on', tone: 'neutral' };
}

/** Compact champion-damage label, e.g. 24312 -> "24.3k". */
export function formatDamage(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${value}`;
}

/** Win/loss tally for a set of analysed games. */
export function winLossRecord(games: AnalysisGame[]): { wins: number; losses: number } {
  const wins = games.filter((g) => g.win).length;
  return { wins, losses: games.length - wins };
}
