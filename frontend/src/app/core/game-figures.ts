/**
 * Every figure the analysis holds for one game, laid out to be checked.
 *
 * The sentences on Patterns rest on these numbers; the team asked to see
 * them raw before trusting a sentence (8 Sep 2026). A column that no player
 * in the game carries is left out, so a replay — totals only — shows a short
 * table rather than a wall of dashes, and an absent number is a dash, never
 * a zero.
 */
import { AnalysisGame, AnalysisPlayer } from '../models/team.models';

export interface FigureColumn {
  key: string;
  label: string;
  /** How the figure was measured, for the header's tooltip. */
  note: string;
}

export interface FigureRow {
  name: string;
  position: string;
  champion: string;
  cells: (string | number | undefined)[];
}

interface FigureSpec extends FigureColumn {
  pick: (p: AnalysisPlayer) => string | number | undefined;
}

const SPECS: FigureSpec[] = [
  { key: 'kills', label: 'K', note: 'Kills', pick: (p) => p.kills },
  { key: 'deaths', label: 'D', note: 'Deaths', pick: (p) => p.deaths },
  { key: 'assists', label: 'A', note: 'Assists', pick: (p) => p.assists },
  { key: 'cs', label: 'CS', note: 'Minions and monsters killed', pick: (p) => p.cs },
  { key: 'damage', label: 'DMG', note: 'Damage to champions', pick: (p) => p.damage },
  { key: 'damageTaken', label: 'Taken', note: 'Damage taken', pick: (p) => p.damageTaken },
  { key: 'visionScore', label: 'Vision', note: 'Vision score', pick: (p) => p.visionScore },
  { key: 'kp', label: 'KP', note: 'Kill participation, share of the team kills', pick: (p) => (p.killParticipation === undefined ? undefined : `${Math.round(p.killParticipation * 100)}%`) },
  { key: 'goldPerMin', label: 'Gold/min', note: "Riot's gold per minute; from the total over the clock on a replay", pick: (p) => p.facts?.goldPerMin },
  { key: 'damageShare', label: 'DMG share', note: "Riot's share of the team's damage to champions", pick: (p) => (p.facts?.damageShare === undefined ? undefined : `${Math.round(p.facts.damageShare * 100)}%`) },
  { key: 'visionPerMin', label: 'Vision/min', note: "Riot's vision score per minute", pick: (p) => p.facts?.visionPerMin },
  { key: 'csAt10', label: 'CS@10', note: 'Lane minions killed in the first ten minutes', pick: (p) => p.facts?.csAt10 },
  { key: 'controlWards', label: 'Ctrl wards', note: 'Control wards placed', pick: (p) => p.facts?.controlWards },
  { key: 'wardTakedowns', label: 'Wards cleared', note: 'Enemy wards taken down', pick: (p) => p.facts?.wardTakedowns },
  { key: 'soloKills', label: 'Solo kills', note: 'Kills with no help', pick: (p) => p.facts?.soloKills },
  { key: 'plates', label: 'Plates', note: 'Turret plates the player took part in', pick: (p) => p.facts?.plates },
  { key: 'tp', label: 'TP kills', note: 'Takedowns after teleporting in; only for a player who took Teleport', pick: (p) => p.facts?.tpTakedowns },
  { key: 'timeDead', label: 'Dead', note: 'Seconds spent dead', pick: (p) => p.facts?.timeDeadSec },
  { key: 'lane', label: 'Lane', note: 'The lane read against the seat across: won, even, lost, or unknown', pick: (p) => (p.lane ? `${p.lane.verdict}${p.lane.theirChampion ? ` vs ${p.lane.theirChampion}` : ''}` : undefined) },
  { key: 'goldDiff', label: 'Gold/min vs lane', note: 'Gold per minute, ours minus theirs', pick: (p) => p.lane?.goldPerMinDiff },
  { key: 'csDiff', label: 'CS@10 vs lane', note: 'CS at ten, ours minus theirs', pick: (p) => p.lane?.csAt10Diff }
];

export function playerFigures(game: AnalysisGame): { columns: FigureColumn[]; rows: FigureRow[] } {
  const present = SPECS.filter((s) => game.players.some((p) => s.pick(p) !== undefined));
  const rows = game.players.map((p) => ({
    name: p.name,
    position: p.position,
    champion: p.champion,
    cells: present.map((s) => s.pick(p))
  }));
  return { columns: present.map(({ key, label, note }) => ({ key, label, note })), rows };
}
