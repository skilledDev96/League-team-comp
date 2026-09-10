#!/usr/bin/env node
/**
 * One-shot check that the review schemas pass the Messages API's own
 * validation before a deploy. The API validates a structured-output schema
 * per request, and a cap it rejects (maxItems, an enum beside a nullable
 * type) is a 400 on every review until the next deploy; the unit tests
 * cannot see that, only the API can.
 *
 * Each schema goes out once with a two-line prompt and a tiny token cap, so
 * the check costs a fraction of a cent. Reads the built lib, so first:
 *
 *   npm run build
 *   ANTHROPIC_API_KEY=... node scripts/check-schema.mjs
 *
 * Prints OK or the API's message per schema; exit code 1 on any failure.
 * The key is read from the environment and never printed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { PLAYER_MODEL, PLAYER_SCHEMA, TEAM_MODEL, TEAM_SCHEMA } from '../lib/game-review.js';

const PROMPT = 'This is a schema check, not a game.\nAnswer with the shortest valid object.';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set; nothing was sent.');
  process.exit(1);
}

const client = new Anthropic({ apiKey: key });

/** The same request shape as the review in src/index.ts (beta client, the fallback beta, the cached system block), so the check walks the path that would 400. */
async function check(name, model, schema) {
  try {
    await client.beta.messages.create({
      model,
      max_tokens: 64,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: PROMPT }]
    });
    console.log(`${name}: OK`);
    return true;
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      console.log(`${name}: 400 ${err.message}`);
    } else if (err instanceof Anthropic.APIError) {
      console.log(`${name}: ${err.status ?? 'error'} ${err.message}`);
    } else {
      console.log(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}

const results = [await check('TEAM_SCHEMA', TEAM_MODEL, TEAM_SCHEMA), await check('PLAYER_SCHEMA', PLAYER_MODEL, PLAYER_SCHEMA)];
process.exit(results.every(Boolean) ? 0 : 1);
