/**
 * Turning a pile of match notes into something readable.
 *
 * A comp that has been played fifty times has fifty notes, and reading all of
 * them is not analysis. What we actually want out of them is the recurring
 * complaint — which champion keeps getting named when the game goes badly — so
 * the notes are mined for champion mentions and ranked by how often they show
 * up in losses.
 */

export interface NoteEntry {
  matchId: string;
  text: string;
  win: boolean;
  /** Epoch millis, as Riot reports it. */
  date?: number;
}

export interface ChampionMention {
  champion: string;
  /** Notes mentioning this champion. */
  count: number;
  /** How many of those were losses — the part worth acting on. */
  losses: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match on word boundaries against the display name, plus a punctuation-free
 * alias so a note typed as "kaisa" still finds "Kai'Sa". Boundaries matter more
 * than they look: without them the two-letter names ("Vi") would match inside
 * ordinary words like "vision".
 */
function mentionPatterns(name: string): RegExp[] {
  const patterns = [new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i')];
  const alias = name.replace(/[^A-Za-z0-9]/g, '');
  if (alias && alias.toLowerCase() !== name.toLowerCase()) {
    patterns.push(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i'));
  }
  return patterns;
}

/**
 * Champions named in the given notes, most-blamed first: losses lead, then
 * total mentions, then alphabetically so the order is stable between renders.
 */
export function championMentions(notes: NoteEntry[], champions: string[]): ChampionMention[] {
  const found = new Map<string, ChampionMention>();

  for (const champion of champions) {
    if (!champion) continue;
    const patterns = mentionPatterns(champion);
    let count = 0;
    let losses = 0;
    for (const note of notes) {
      if (!patterns.some((pattern) => pattern.test(note.text))) continue;
      count += 1;
      if (!note.win) losses += 1;
    }
    if (count > 0) {
      found.set(champion, { champion, count, losses });
    }
  }

  return [...found.values()].sort(
    (a, b) => b.losses - a.losses || b.count - a.count || a.champion.localeCompare(b.champion)
  );
}

export interface NoteRollup {
  notes: NoteEntry[];
  wins: number;
  losses: number;
  mentions: ChampionMention[];
}

/** Newest first — a note from last week says more than one from the preseason. */
export function rollupNotes(notes: NoteEntry[], champions: string[]): NoteRollup {
  const ordered = [...notes].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return {
    notes: ordered,
    wins: ordered.filter((n) => n.win).length,
    losses: ordered.filter((n) => !n.win).length,
    mentions: championMentions(ordered, champions)
  };
}
