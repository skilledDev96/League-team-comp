/**
 * A stored date string as epoch ms, the way people typed it (13 Sep 2026).
 *
 * A bare "YYYY-MM-DD" is local midnight, not UTC midnight — the rule `UiService.parseDate` has always
 * used, because UTC midnight renders as the day before in any negative-offset timezone. Anything else
 * goes through `Date.parse` (a datetime-local value, an ISO stamp), and free text such as "Sat 20:00"
 * is `null` rather than a guess.
 */
export function parseLocalDate(value?: string | null): number | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}
