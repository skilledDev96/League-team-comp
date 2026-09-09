/**
 * Two letters for an email key: the first of each part of the local part
 * ("ruan.hart" is RH), or the first two letters when there is one part. The
 * film room and the review panel show who picked and who wrote without
 * printing anyone's address.
 */
export function initialsOf(emailKey: string): string {
  const local = (emailKey || '').split('@')[0];
  const parts = local.split(/[._\-+]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase() || '?';
}
