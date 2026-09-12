/**
 * Whether the browser has asked us to spend less data (13 Sep 2026).
 *
 * This is the Save-Data request header's browser-side twin, `navigator.connection.saveData`. The film's
 * champion clips have always stood down for it, and the home page's rotating splash needs the same answer,
 * so the check lives here once rather than in each of them.
 *
 * Most browsers do not carry `connection` at all, and a test or a server has no `navigator`: both read as
 * off, since nobody asked. Only a real `true` counts, and nothing here ever throws.
 */
export function prefersSaveData(): boolean {
  try {
    if (typeof navigator === 'undefined') return false;
    return (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData === true;
  } catch {
    return false;
  }
}
