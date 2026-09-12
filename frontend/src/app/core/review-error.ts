/**
 * What to say when a review does not come back (12 Sep 2026).
 *
 * The reviewer is a paid API behind a Cloud Function, and when it refuses it refuses in its own
 * words — a status code and a JSON body. Those reached the screen verbatim:
 *
 *   The reviewer's answer (400): 400 {"type":"error","error":{"type":"invalid_request_error",
 *   "message":"Your credit balance is too low to access the Anthropic API. Please go to Plans &
 *   Billing to upgrade or purchase credits."},"request_id":"req_011CeyLcXrgojb..."}
 *
 * Every fact a person needs is in there and none of it is readable, and the one thing they have to
 * do — top up the credit — is buried in the middle of a machine's sentence. So the raw text is
 * turned into a sentence and, where there is one, the action that clears it; the original goes
 * behind an info tip, because when the guess is wrong the real text is the only way through.
 *
 * Matched on what the message SAYS rather than on the status alone: the same 400 carries a dozen
 * unrelated refusals, and a provider is free to renumber them. The status is the tie-break.
 */
export interface ReviewFailure {
  /** One sentence naming what went wrong, in the team's terms. */
  said: string;
  /** What to do about it, when there is something. */
  fix?: string;
  /** The provider's own words, for the tip — never empty, so the tip always has something to show. */
  detail: string;
}

/** The provider's message, dug out of whatever wrapping it arrived in. */
function innerMessage(raw: string): string {
  const at = raw.indexOf('{');
  if (at < 0) return raw;
  try {
    const body = JSON.parse(raw.slice(at)) as { error?: { message?: string }; message?: string };
    return (body.error?.message ?? body.message ?? '').trim() || raw;
  } catch {
    // Not JSON, or JSON with something after it — truncated, double-wrapped, a body with trailing
    // junk. The sentence is still in there; a quote inside it would cut this short, which is a fair
    // trade for a fallback that cannot itself throw.
    const m = /"message"\s*:\s*"([^"]*)"/.exec(raw);
    return m ? m[1] : raw;
  }
}

const STATUS = /\((\d{3})\)|\b(4\d\d|5\d\d)\b/;

/**
 * The failure as something a coach can act on. Always answers: an unrecognised refusal keeps the
 * provider's own sentence, which is better than a shrug and is why `detail` is never dropped.
 */
export function reviewFailure(raw: string | undefined): ReviewFailure | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const inner = innerMessage(text);
  const low = inner.toLowerCase();
  const status = Number(STATUS.exec(text)?.[1] ?? STATUS.exec(text)?.[2] ?? 0);

  if (low.includes('credit balance') || low.includes('billing') || low.includes('quota')) {
    return {
      said: 'The team’s Anthropic credit has run out, so the reviewer would not start.',
      fix: 'Top it up in the Anthropic Console under Plans & Billing, then press Re-review. Nothing was spent and nothing was lost.',
      detail: inner
    };
  }
  if (status === 429 || low.includes('rate limit')) {
    return { said: 'The reviewer is rate limited at the moment.', fix: 'Wait a minute and press Re-review; the game is untouched.', detail: inner };
  }
  if (status === 529 || low.includes('overloaded')) {
    return { said: 'The reviewer is overloaded right now.', fix: 'Give it a minute and press Re-review.', detail: inner };
  }
  if (status === 401 || status === 403 || low.includes('authentication') || low.includes('api key') || low.includes('x-api-key')) {
    return { said: 'The reviewer would not accept our key.', fix: 'An admin can check the ANTHROPIC_API_KEY secret and redeploy the functions.', detail: inner };
  }
  if (low.includes('sign in')) return { said: inner, detail: inner };
  if (low.includes('declined')) {
    return { said: 'The reviewer declined to write about this game.', fix: 'That usually means the facts were too thin to say anything honest about.', detail: inner };
  }
  if (status >= 500) {
    return { said: 'The reviewer failed on its own side.', fix: 'Press Re-review; if it happens twice, the detail below is worth keeping.', detail: inner };
  }
  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('timeout') || low.includes('aborted')) {
    return { said: 'The request never reached the reviewer.', fix: 'Check the connection and press Re-review.', detail: inner };
  }
  // Unknown: the provider's own sentence, which is still better than its JSON.
  return { said: inner, detail: inner };
}
