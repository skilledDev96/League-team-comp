/**
 * What the reviews keep saying about one player.
 *
 * A player with six reviewed games has six strengths and six things to work
 * on, and reading them one by one hides the point: that vision came up in
 * four of them. This counts the themes each note touches, so the profile can
 * open on "vision, in 4 of 6 games" and keep the game-by-game notes behind
 * a fold (8 Sep 2026). Rule-based on purpose — the notes are already the
 * model's; the count should be something a person can check by reading.
 */

export interface CoachingNoteLike {
  win: boolean;
  date: number;
  strength: string;
  workOn: string;
}

export interface Theme {
  key: string;
  label: string;
  words: RegExp;
}

export const THEMES: readonly Theme[] = [
  { key: 'vision', label: 'Vision', words: /\b(ward|wards|warded|vision|dark)\b/i },
  { key: 'caught', label: 'Getting caught', words: /\b(alone|caught|overextend\w*|solo death\w*|face-?check\w*)\b/i },
  { key: 'lane', label: 'Laning', words: /\b(lane|laning|cs|farm\w*|minion\w*|at ten|plates?)\b/i },
  { key: 'objectives', label: 'Objectives', words: /\b(dragon\w*|baron|herald|grubs?|objective\w*|tower\w*|inhib\w*)\b/i },
  { key: 'fights', label: 'Fights and grouping', words: /\b(fight\w*|group\w*|teamfight\w*|skirmish\w*|engage\w*|flank\w*|two-for-nothing|for nothing)\b/i },
  { key: 'tempo', label: 'Tempo and resets', words: /\b(roam\w*|tempo|reset\w*|recall\w*|back\w*|rotat\w*|pace)\b/i },
  { key: 'damage', label: 'Damage and carrying', words: /\b(damage|kill participation|carr\w+|dps|solo kills?|kills)\b/i }
];

/** Whether one note touches a theme, by the same words the digest counts. */
export function touches(themeKey: string, text: string): boolean {
  const theme = THEMES.find((t) => t.key === themeKey);
  return !!theme && theme.words.test(text);
}

export interface ThemeCount {
  key: string;
  label: string;
  games: number;
}

export interface CoachingDigest {
  games: number;
  wins: number;
  /** Themes the work-on notes touch, most often first; only those that appear. */
  workOn: ThemeCount[];
  /** Themes the strengths touch, likewise. */
  strengths: ThemeCount[];
  /** The newest note's sentences, the quickest thing to read. */
  latestWorkOn?: string;
  latestStrength?: string;
}

function count(texts: readonly string[]): ThemeCount[] {
  return THEMES.map((t) => ({ key: t.key, label: t.label, games: texts.filter((text) => t.words.test(text)).length }))
    .filter((c) => c.games > 0)
    .sort((a, b) => b.games - a.games);
}

export function digestNotes(notes: readonly CoachingNoteLike[]): CoachingDigest {
  const sorted = [...notes].sort((a, b) => b.date - a.date);
  const latest = sorted[0];
  return {
    games: notes.length,
    wins: notes.filter((n) => n.win).length,
    workOn: count(notes.map((n) => n.workOn).filter(Boolean)),
    strengths: count(notes.map((n) => n.strength).filter(Boolean)),
    ...(latest?.workOn && { latestWorkOn: latest.workOn }),
    ...(latest?.strength && { latestStrength: latest.strength })
  };
}
