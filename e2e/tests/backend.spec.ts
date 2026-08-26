import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { API } from '../playwright.config';

/**
 * The deployed Cloud Functions.
 *
 * riotKeyHealth is the only endpoint that answers without a signed-in user, and
 * it is the one worth asking: it proves the functions are up, that the Riot key
 * they hold still works, and which commit they were built from.
 */

interface KeyHealth {
  ok: boolean;
  status: number;
  message: string;
  checkedAt: string;
  backendSha?: string;
  appRateLimit?: string;
}

async function health(request: import('@playwright/test').APIRequestContext): Promise<KeyHealth> {
  const response = await request.get(`${API}/riotKeyHealth`, { timeout: 45_000 });
  expect(response.status(), 'health endpoint should answer 200').toBe(200);
  return (await response.json()) as KeyHealth;
}

test('the functions are up and answering', async ({ request }) => {
  const body = await health(request);
  expect(body.checkedAt).toBeTruthy();
  expect(Date.parse(body.checkedAt)).not.toBeNaN();
});

test('the Riot API key is still valid', async ({ request }) => {
  const body = await health(request);
  // The key expires; when it does, enrichment and analysis both stop silently
  // as far as the UI is concerned. This is the early warning.
  expect(body.ok, `Riot key not healthy: ${body.status} ${body.message}`).toBe(true);
  expect(body.status).toBe(200);
});

test('the backend reports the commit it was built from', async ({ request }) => {
  const body = await health(request);
  expect(body.backendSha, 'backendSha missing — backend predates the SHA stamp').toBeTruthy();
  expect(body.backendSha).toMatch(/^[0-9a-f]{7,40}$/);
});

test('the deployed backend matches this checkout', async ({ request }) => {
  // Pages publishes the frontend on every push; the functions only move when
  // someone deploys them. This is the drift that gap produces, and the reason
  // the SHA is stamped in at all.
  let localSha: string;
  try {
    localSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    test.skip(true, 'not a git checkout');
    return;
  }

  const body = await health(request);
  expect(
    body.backendSha,
    `deployed backend is ${body.backendSha}, this checkout is ${localSha} — ` +
      'run `npm run deploy:functions` from the repo root'
  ).toBe(localSha);
});

test('the endpoint answers CORS preflight, which the browser needs', async ({ request }) => {
  const response = await request.fetch(`${API}/riotKeyHealth`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://skilleddev96.github.io', 'Access-Control-Request-Method': 'GET' },
    timeout: 30_000
  });
  expect(response.status()).toBeLessThan(400);
});
