#!/usr/bin/env node
// Test a Riot API key before deploying it, and report which tier it is.
//
//   npm run key:check          prompt for a key, validate it, report the tier
//   npm run key:update         same, then set the secret and redeploy functions
//
// Dev and Personal keys are told apart by their rate limits: a Development key
// is 20 req/s + 100 req/2min, a Personal/Production key is far higher.

import { createInterface } from 'node:readline/promises';
import process, { stdin, stdout, argv } from 'node:process';
import { spawnSync } from 'node:child_process';

const TEST_URL = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';
const DEV_LIMIT = '20:1,100:120';

async function main() {
  const deploy = argv.includes('--deploy');

  const rl = createInterface({ input: stdin, output: stdout });
  const key = (await rl.question('Paste your Riot API key (RGAPI-...): ')).trim();
  rl.close();

  if (!key) {
    console.error('\nNo key entered. Aborted.');
    process.exitCode = 1;
    return;
  }
  if (!key.startsWith('RGAPI-')) {
    console.warn('\nWarning: keys normally start with "RGAPI-". Continuing anyway.\n');
  }

  console.log('\nTesting key against Riot…');
  let response;
  try {
    response = await fetch(TEST_URL, { headers: { 'X-Riot-Token': key } });
  } catch (err) {
    console.error(`Could not reach Riot: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  if (response.status === 401 || response.status === 403) {
    console.error(`\n✗ Key rejected (${response.status}) — expired or invalid.`);
    console.error('  Get a fresh one at https://developer.riotgames.com');
    process.exitCode = 1;
    return;
  }
  if (!response.ok) {
    console.error(`\n✗ Unexpected response from Riot: ${response.status}`);
    process.exitCode = 1;
    return;
  }

  const appLimit = response.headers.get('x-app-rate-limit') ?? 'unknown';
  const isDev = appLimit === DEV_LIMIT;

  console.log('\n✓ Key is valid.');
  console.log(`  Rate limit: ${appLimit}`);
  console.log(
    isDev
      ? '  Tier: DEVELOPMENT — expires every 24h, you will be doing this again tomorrow.'
      : '  Tier: PERSONAL/PRODUCTION — does not expire. This is the one you want.'
  );

  if (!deploy) {
    console.log('\nTo deploy this key, re-run with:  npm run key:update');
    return;
  }

  console.log('\nSetting secret RIOT_API_KEY…');
  const set = spawnSync('firebase', ['functions:secrets:set', 'RIOT_API_KEY'], {
    input: `${key}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true
  });
  if (set.status !== 0) {
    console.error('Secret update failed. Aborted before deploy.');
    process.exitCode = 1;
    return;
  }

  console.log('\nDeploying functions (secrets bind at deploy time)…');
  const deployed = spawnSync('firebase', ['deploy', '--only', 'functions'], {
    stdio: 'inherit',
    shell: true
  });
  if (deployed.status !== 0) {
    console.error('Deploy failed.');
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ Done. Hit "Refresh from Riot" in the app.');
}

main();
