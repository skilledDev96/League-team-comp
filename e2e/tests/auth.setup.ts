import { expect, test as setup } from '@playwright/test';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { AUTH_STATE } from '../playwright.config';

/**
 * Signs in once and saves the session for the authenticated tests to reuse.
 *
 * The login screen is Google only (9 Sep 2026), and an OAuth popup cannot be
 * driven from a test: it fights bot detection and can demand a second factor.
 * So the runner mints a Firebase custom token for the viewer account with the
 * service account it holds, and hands it to the app on the fragment of the
 * login route. The app signs in with it and then runs the same access gate as
 * everyone else, so the token alone grants nothing; there is no password
 * provider and no minting endpoint on the internet.
 *
 * Firebase keeps its session in IndexedDB rather than cookies, so the saved
 * state has to include it.
 */
setup('sign in', async ({ page, context }) => {
  const email = process.env.E2E_EMAIL!;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  const user = await getAuth(app).getUserByEmail(email);
  const token = await getAuth(app).createCustomToken(user.uid);

  // The site root is the login page and is served directly; a deeper path
  // goes through the Pages 404 redirect, which is one more place to lose a
  // fragment.
  await page.goto(`./#token=${encodeURIComponent(token)}`);

  // The page reports its own failures, and its message is far more useful than
  // a timeout on whatever we were waiting for next.
  const error = page.locator('[role="alert"]');
  await expect
    .poll(async () => ((await error.isVisible()) ? await error.innerText() : 'signed-in'), {
      timeout: 30_000,
      message: 'sign-in did not complete'
    })
    .toBe('signed-in');

  // The nav only renders once a session with a role is established.
  await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible({ timeout: 30_000 });

  // A new account is met by the welcome tour, which covers the page. Dismissing
  // it here writes userPrefs/{email} — a rule every signed-in user may write,
  // viewer included — so it stays dismissed rather than reappearing per test.
  // Scoped to the tour's card (10 Sep 2026): the Before you play reminder and
  // the Games banner each end in a "Got it" of their own, and two matches make
  // the unscoped locator throw in strict mode.
  const gotIt = page.locator('.tour-card').getByRole('button', { name: /^(Skip tour|Got it)$/ });
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }

  await context.storageState({ path: AUTH_STATE, indexedDB: true });
});
