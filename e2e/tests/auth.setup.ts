import { existsSync, readFileSync } from 'node:fs';
import { expect, test as setup } from '@playwright/test';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { AUTH_STATE } from '../playwright.config';

/**
 * The service account, however the machine happens to hold it (12 Sep 2026).
 *
 * In CI the secret IS the JSON. On a developer's machine the same variable
 * conventionally points at the key file instead, and `JSON.parse` then failed on
 * the first character of a Windows path — so the authenticated half of the suite
 * could be run only by CI, which is the half most likely to be broken by a change
 * to the app. Accepting both makes it runnable before a push rather than after.
 */
function serviceAccountFromEnv(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  if (existsSync(trimmed)) return JSON.parse(readFileSync(trimmed, 'utf8'));
  throw new Error('FIREBASE_SERVICE_ACCOUNT is neither JSON nor a path to a file that exists.');
}

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
  const serviceAccount = serviceAccountFromEnv(process.env.FIREBASE_SERVICE_ACCOUNT!);
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  const user = await getAuth(app).getUserByEmail(email);
  const token = await getAuth(app).createCustomToken(user.uid);

  // Signed out first, and settled, before the token is handed over (27 Sep
  // 2026). Under the members-only rules a listener opened on the login page is
  // refused and never retried, so a build that opens them there hangs on
  // "Loading team data…" after sign-in. But when the token rode in on the first
  // load, sign-in raced those refusals: two identitytoolkit round trips and the
  // access read against Firestore's channel handshake and a rules evaluation.
  // When sign-in won, Firestore re-sent the still-pending listens under the new
  // user, they were allowed, and the check below passed against exactly the
  // build it exists to catch. A real Google popup takes seconds, so for a person
  // the refusals always land first; this makes the runner meet the same order.
  //
  // So: the site root (served directly; a deeper path goes through the Pages
  // 404 redirect), the login page drawn, and the Listen channel answering, which
  // it does for the public meta/settings listen on every build. Then a moment
  // more, so anything else listened to at first paint has had its answer, and
  // only then the token.
  const listenChannel = page.waitForResponse((r) => /firestore\.googleapis\.com\/.*\/Listen\/channel/.test(r.url()), {
    timeout: 30_000
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Team Login' })).toBeVisible({ timeout: 30_000 });
  await listenChannel;
  await page.waitForTimeout(3_000);

  // The token goes in without a reload, so everything opened above stays as it
  // was: the login route with the token on its fragment, pushed onto history,
  // and a popstate so the router builds a fresh LoginComponent there (the site
  // root is another route, so it is not reused), whose constructor reads the
  // fragment, clears it from the address bar and signs in.
  await page.evaluate((fragment) => {
    history.pushState(null, '', new URL(`login#${fragment}`, document.baseURI).href);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, `token=${encodeURIComponent(token)}`);

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

  // And the team data has to follow, on this very page (27 Sep 2026). Everything
  // below the nav check runs in the tab that signed in, with no reload, which is
  // how a person meets the app the first time. Under the members-only rules a
  // listener opened on the signed-out login page is refused and never retried,
  // and the shell then sat on "Loading team data…" over a nav that was already
  // drawn: every check above passed, and every test after this one reloads the
  // page, which opens the listeners afresh and hides it. The overlay is on screen
  // whenever the nav is and the data is not, so waiting for it to go is waiting
  // for the first players snapshot (or a refusal, which settles it too; the
  // Roster check below is what tells the two apart).
  await expect(page.getByText('Loading team data…')).toBeHidden({ timeout: 30_000 });

  // A new account is met by the welcome tour, which covers the page. Dismissing
  // it here writes userPrefs/{email} — which the rules let any member write for
  // their own email, viewer included — so it stays dismissed rather than
  // reappearing per test.
  // Scoped to the tour's card (10 Sep 2026): the Before you play reminder and
  // the Games banner each end in a "Got it" of their own, and two matches make
  // the unscoped locator throw in strict mode.
  //
  // Waited for rather than checked once (13 Sep 2026): the welcome now starts on
  // Home, where sign-in lands, and only once the user's prefs have loaded and its
  // first anchor is on the page — a single look straight after the nav appears
  // saw no card, and the tour then opened over the first test instead.
  const gotIt = page.locator('.tour-card').getByRole('button', { name: /^(Skip tour|Got it)$/ });
  const shown = await gotIt
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (shown) {
    await gotIt.click();
    await expect(gotIt).toBeHidden();
  }

  // Real data, still without a reload: the nav's Roster link is an in-app
  // navigation, and the poster draws one panel per starter, which it can only do
  // once the players collection has answered. A refused players listen ends the overlay above
  // with an empty roster, which this catches.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Roster', exact: true }).click();
  await expect(page).toHaveURL(/\/roster/);
  await expect(page.locator('.roster-poster .roster-panel-open').first()).toBeVisible({ timeout: 30_000 });

  await context.storageState({ path: AUTH_STATE, indexedDB: true });
});
