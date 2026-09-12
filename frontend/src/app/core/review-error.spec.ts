import { describe, expect, it } from 'vitest';
import { reviewFailure } from './review-error';

/**
 * The case this was written for, verbatim off the screen on 12 Sep 2026: the whole provider body
 * reached the card, overflowed it, and buried the one thing the lead had to do.
 */
const CREDIT =
  'The reviewer\'s answer (400): 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CeyLcXrgojb"}';

describe('reviewFailure', () => {
  it('turns the credit refusal into the sentence and the action', () => {
    const f = reviewFailure(CREDIT)!;
    expect(f.said).toContain('credit has run out');
    expect(f.fix).toContain('Plans & Billing');
    // The reader is told nothing was spent, because that is the first thing they wonder.
    expect(f.fix).toContain('Nothing was spent');
    // The provider's own words survive for the tip, without the JSON around them.
    expect(f.detail).toBe('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
    expect(f.detail).not.toContain('{');
    expect(f.said).not.toContain('request_id');
  });

  it('names the refusals worth naming, and says what clears each', () => {
    expect(reviewFailure('429 rate limit exceeded')!.said).toContain('rate limited');
    expect(reviewFailure('The reviewer\'s answer (529): overloaded_error')!.said).toContain('overloaded');
    expect(reviewFailure('401 {"error":{"message":"invalid x-api-key"}}')!.said).toContain('would not accept our key');
    expect(reviewFailure('503 upstream failure')!.said).toContain('on its own side');
    expect(reviewFailure('TypeError: Failed to fetch')!.said).toContain('never reached the reviewer');
    for (const raw of ['429 rate limit exceeded', '401 {"error":{"message":"invalid x-api-key"}}']) {
      expect(reviewFailure(raw)!.fix, raw).toBeTruthy();
    }
  });

  it('keeps the provider sentence when it recognises nothing, rather than shrugging', () => {
    const f = reviewFailure('{"error":{"message":"Something nobody has seen before."}}')!;
    expect(f.said).toBe('Something nobody has seen before.');
    expect(f.detail).toBe('Something nobody has seen before.');
  });

  it('reads a message out of a body it cannot parse', () => {
    // A truncated or double-wrapped body still carries the sentence, and that is what matters.
    const f = reviewFailure('400 {"error":{"message":"Your credit balance is too low"} trailing junk')!;
    expect(f.said).toContain('credit has run out');
  });

  it('has nothing to say about nothing', () => {
    expect(reviewFailure(undefined)).toBeNull();
    expect(reviewFailure('   ')).toBeNull();
  });
});
