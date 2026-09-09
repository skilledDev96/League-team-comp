/**
 * Turn an opponent name into a stable key (9 Sep 2026, moved here from the
 * old Scrims page so the Prep & Draft page and the migration share it).
 *
 * Case, spacing and punctuation are all things people type inconsistently
 * about the same team — "MOSS", "Moss", "moss " — and none of them mean a
 * different opponent. Letters and digits only, so the key is also a safe
 * Firestore document id.
 */
export function slugOpponent(name: string | undefined): string {
  const slug = (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unnamed';
}

/** What an unnamed replay files under, so it is never lost off the page. */
export const UNNAMED_OPPONENT = 'Unnamed opponent';
