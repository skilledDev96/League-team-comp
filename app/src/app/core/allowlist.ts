// Only these emails may edit team data (applies to Google and Email/Password sign-in).
// Add each teammate's login email here, lowercased. Keep this in sync with the
// allowlist in app/firestore.rules — the rules are the real enforcement.
export const EDITOR_EMAILS: string[] = [
  'ruanhart7@gmail.com'
];

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  return EDITOR_EMAILS.includes(email.toLowerCase());
}
