import { expect, test } from '@playwright/test';

/**
 * The deployed frontend. GitHub Pages has no server-side routing, so a deep
 * link is served as a 404 whose body is the app — these check that the
 * arrangement actually works, since a broken fallback looks like a dead link
 * rather than an error.
 */

test('the site is served and boots', async ({ page }) => {
  const response = await page.goto('./');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/BomSquad/i);
});

test('an unauthenticated visitor is gated, not shown team data', async ({ page }) => {
  await page.goto('./');
  // The guard renders the login screen in place rather than changing the URL,
  // so the assertion has to be on what is shown, not where the browser is.
  await expect(page.getByText(/Team Login/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText('Bom Squad Comps');
});

test('a deep link resolves to the app rather than a dead page', async ({ page }) => {
  // Pages answers 404 here and serves 404.html, which is a copy of index.html.
  // The status is expected; what matters is that the app boots and routes.
  await page.goto('./comps');
  // The guard sends a visitor to /login?returnUrl=%2Fcomps. The pattern used to end at "login", so
  // it only passed when the page's load event beat that redirect — and a heavier stylesheet on
  // 13 Sep 2026 made the redirect win three runs in four.
  await page.waitForURL(/\/(login(\?returnUrl=[^#]*)?|comps)$/, { timeout: 30_000 });
  await expect(page.locator('app-root')).toBeAttached();
});

test('the page loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Pages serves deep links as 404, so the document request logs one by
    // design. Anything else is a real error.
    if (/404/.test(text) && /League-team-comp/.test(text)) return;
    // A resource-load failure carries no URL here; the response listener
    // below reports those with one, and knows which 404s are benign.
    if (/Failed to load resource/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('response', (response) => {
    if (response.status() !== 404) return;
    if (response.request().resourceType() === 'document') return;
    // Firestore closes a Listen channel with a 404 as part of its own
    // long-polling lifecycle; it failed this check on 8 Sep 2026 with the app
    // itself fine. Any other 404 is still a missing asset.
    if (/firestore\.googleapis\.com\/.*\/Listen\/channel/.test(response.url())) return;
    errors.push(`404: ${response.url()}`);
  });

  // The film room's route resolves for any match id and, signed out, lands on
  // the login like every other deep link; a bad id must not throw on the way.
  for (const path of ['./', './film/none']) {
    await page.goto(path);
    // Not networkidle: Firestore holds a long-lived connection open, so the page
    // is never idle. Wait for the app to have rendered instead.
    await expect(page.getByText(/Team Login/i)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
  }

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('the login screen offers a way in', async ({ page }) => {
  await page.goto('./login');
  await expect(page.getByRole('button', { name: /sign in|google/i }).first()).toBeVisible();
});

/**
 * Is the site we are testing the one this run just built? (12 Sep 2026.)
 *
 * `verify` starts the moment `deploy` returns, and Pages propagates on its own
 * clock. On 12 Sep two runs went green while testing the previous build, and a
 * genuinely broken check reached main because of it. A green verify has to mean
 * THIS build was checked.
 *
 * Skipped outside CI, where there is no commit to compare against, and skipped
 * on a checkout whose HEAD is not the commit being verified.
 */
test('the deployed site is the build this run made', async ({ request }) => {
  const expected = process.env.GITHUB_SHA;
  test.skip(!expected, 'no GITHUB_SHA: nothing to compare the deployed build against');

  const short = expected!.slice(0, 7);
  // Pages can take a little while to serve the new build; poll rather than fail
  // on the first miss, and say plainly what was still being served if it never
  // arrives — "stale" is a different problem from "broken".
  const deadline = Date.now() + 90_000;
  let served = '(no build.json served)';
  while (Date.now() < deadline) {
    const res = await request.get('./build.json', { headers: { 'cache-control': 'no-cache' } });
    if (res.ok()) {
      const body = (await res.json()) as { sha?: string };
      served = body.sha ?? '(no sha in build.json)';
      if (served === short) return;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(
    `The site is still serving build ${served}, not ${short}. Everything checked after this ran against the previous deploy, so a green run would not have meant anything.`
  );
});
