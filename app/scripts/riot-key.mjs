#!/usr/bin/env node
// Test a Riot API key before deploying it, then optionally set the secret and
// redeploy. Three ways to supply the key, so you never have to paste into a
// terminal that won't let you:
//
//   npm run key:check                     read ./riot-key.txt (gitignored)
//   npm run key:check -- --key=RGAPI-…    pass it inline
//   npm run key:check -- --file=path.txt  read from somewhere else
//   (falls back to prompting if none of the above)
//
//   npm run key:update                    same, then set secret + deploy
//
// Easiest flow when terminal paste is broken: create app/riot-key.txt in the
// editor, paste the key there, save, then run `npm run key:update`.

import { createInterface } from 'node:readline/promises';
import process, { stdin, stdout, argv } from 'node:process';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';

const TEST_URL = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';
const DEFAULT_KEY_FILE = 'riot-key.txt';

function argValue(name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : '';
}

async function readKey() {
  const inline = argValue('key');
  if (inline) return { key: inline, source: 'argument', file: '' };

  const file = argValue('file') || DEFAULT_KEY_FILE;
  if (existsSync(file)) {
    const key = readFileSync(file, 'utf8').trim();
    if (key) return { key, source: `file ${file}`, file };
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const key = (await rl.question('Paste your Riot API key (RGAPI-...): ')).trim();
  rl.close();
  return { key, source: 'prompt', file: '' };
}

async function main() {
  const deploy = argv.includes('--deploy');
  const { key, source, file } = await readKey();

  if (!key) {
    console.error(`\nNo key found. Create app/${DEFAULT_KEY_FILE} with the key in it, or pass --key=RGAPI-…`);
    process.exitCode = 1;
    return;
  }
  console.log(`Key read from ${source}.`);
  if (!key.startsWith('RGAPI-')) {
    console.warn('Warning: keys normally start with "RGAPI-". Continuing anyway.');
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
  console.log('\n✓ Key is valid.');
  console.log(`  Rate limit: ${appLimit}`);
  console.log('  (Rate limit does not identify the tier — an approved Personal');
  console.log('   key can carry the same limits as a Development key.)');

  if (!deploy) {
    console.log('\nTo deploy this key, run:  npm run key:update');
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

  // The key is live in Secret Manager now; don't leave a copy lying around.
  if (file && existsSync(file)) {
    unlinkSync(file);
    console.log(`\nRemoved ${file} (key is in Secret Manager now).`);
  }
  console.log('\n✓ Done. Hit "Refresh from Riot" in the app.');
}

main();
