import { expect, test } from '@playwright/test';

/**
 * The signed-in surface, using the session saved by auth.setup.
 *
 * Read-only on purpose. The account is a viewer, so these exercise real pages
 * against real data without being able to touch it — writing would mean tests
 * mutating a live tournament, which is what a second Firebase project is for.
 *
 * The assertions are structural rather than about content: that the roster
 * renders, not who is on it. A test that knows the comps are called "Engage"
 * and "Poke" breaks when someone renames one, which teaches people to ignore it.
 */

/**
 * The setup step dismisses the welcome tour, but a fresh account or a lost
 * userPrefs write would bring it back over the page. Cheap to absorb here
 * rather than have every test fail on an overlay.
 *
 * Scoped to the tour's card (10 Sep 2026): the Before you play reminder and
 * the Games banner each end in a "Got it" of their own, and a second match
 * makes the unscoped locator throw in strict mode instead of clicking.
 */
const tourButton = (page: import('@playwright/test').Page) =>
  page.locator('.tour-card').getByRole('button', { name: /^(Skip tour|Got it)$/ });

test.beforeEach(async ({ page }) => {
  page.on('load', () => {
    void tourButton(page)
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  });
});

test('the session gets past the login gate', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText(/Team Login/i)).toBeHidden();
  await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible();
});

test('the account is a viewer, so the tests cannot change anything', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible();

  // If this fails the test account has been over-granted, and every test below
  // is one stray click away from editing live data. Worth failing loudly.
  await expect(
    page.getByRole('button', { name: /edit mode/i }),
    'test account can edit — it should be a viewer'
  ).toHaveCount(0);
});

test('the roster page renders players', async ({ page }) => {
  await page.goto('./players');
  await expect(page.locator('.player-intel-card').first()).toBeVisible({ timeout: 30_000 });
});

test('the comps page renders comps', async ({ page }) => {
  await page.goto('./comps');
  await expect(page.locator('.comp-card').first()).toBeVisible({ timeout: 30_000 });
});

test('the games page renders', async ({ page }) => {
  await page.goto('./games');
  // The game list starts folded (8 Sep 2026): its head or the line saying
  // there are no games means the page worked; Show then opens the rows.
  await expect(page.locator('.games-list-head, .games-empty').first()).toBeVisible({
    timeout: 30_000
  });
  const fold = page.locator('[data-tour="games-list-fold"]');
  if (await fold.count()) {
    await fold.first().click();
    await expect(page.locator('.games-list, .games-empty').first()).toBeVisible();
  }
});

test('the old analysis path still lands on games', async ({ page }) => {
  await page.goto('./analysis');
  await expect(page.getByRole('heading', { name: 'Games' })).toBeVisible({ timeout: 30_000 });
});

test('the tournaments page offers both views', async ({ page }) => {
  await page.goto('./tournaments');
  await expect(page.getByRole('button', { name: /^Plan$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Draft$/ })).toBeVisible();
});

test('the draft board loads', async ({ page }) => {
  await page.goto('./tournaments');
  await page.getByRole('button', { name: /^Draft$/ }).click();
  // An in-app navigation fires no load event; a tour due on the draft view is dismissed here.
  await tourButton(page).click({ timeout: 2_000 }).catch(() => undefined);
  // A series with games, or the message saying there are none — either is the
  // page working; which one depends on where the split happens to be. Match
  // that message exactly rather than any .muted, which every page has.
  await expect(
    page.locator('.draft-page').or(page.getByText(/No series to draft/i)).first()
  ).toBeVisible({ timeout: 30_000 });
});

test('the review path opens the patterns tab', async ({ page }) => {
  await page.goto('./review');
  // The toolbar means there are games to review; the empty state means nobody
  // has refreshed on Analysis yet. Both are the page working, and which one
  // shows is not this test's business. Deliberately not asserting on loss
  // cards: a week with no losses is a real outcome, not a broken page.
  await expect(
    page.locator('.review-toolbar').or(page.getByText(/No match data yet/i)).first()
  ).toBeVisible({ timeout: 30_000 });
});

test('no console errors while moving around signed in', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Resource-load failures surface here with no usable location; the
    // response listener below reports those with a URL instead.
    if (msg.type() !== 'error' || /Failed to load resource/.test(msg.text())) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('response', (response) => {
    if (response.status() !== 404) return;
    // Pages serves deep links as 404 by design; the app boots from that body.
    if (response.request().resourceType() === 'document') return;
    // Firestore's long-polling closes a Listen channel with a 404 when a page
    // navigates away mid-session. That is the transport's lifecycle, not an
    // app error, and it failed the deploy verify once on 8 Sep 2026 while
    // every check passed against the same build.
    if (/firestore\.googleapis\.com\/.*\/Listen\/channel/.test(response.url())) return;
    errors.push(`404: ${response.url()}`);
  });

  for (const path of ['./', './comps', './games', './review', './tournaments', './film/none']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Comps' })).toBeVisible({ timeout: 30_000 });
  }

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
