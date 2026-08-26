/**
 * Turning a failed Riot response into an error worth reading.
 *
 * "The Riot API failed" is useless when only one endpoint is actually being
 * refused — which is exactly how a retired endpoint hid once already: a 403 on
 * league-v4 looked identical to a dead key, and the key was fine.
 */

/** Short API name from a Riot URL, e.g. "league-v4". */
export function riotEndpointLabel(url: string): string {
  const match = /\/(?:lol|riot)\/([a-z-]+)\/(v\d+)/.exec(url);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return 'the Riot API';
}

/**
 * 401 and 403 need different fixes — a new key versus a key that is not
 * authorised for that API — so they never collapse into one message.
 */
export function riotError(status: number, url: string): Error {
  const endpoint = riotEndpointLabel(url);

  if (status === 401) {
    return new Error(`Riot API key rejected (401) on ${endpoint} — the key is invalid or expired.`);
  }
  if (status === 403) {
    return new Error(
      `Riot API forbidden (403) on ${endpoint} — the key is valid but not authorised for this API.`
    );
  }
  return new Error(`Riot API request failed (${status}) on ${endpoint}.`);
}

/**
 * How long to wait before retrying a rate-limited call. Riot sends the window
 * in Retry-After; the extra half-second keeps the retry from landing on the
 * boundary and being refused again.
 */
export function retryDelayMs(retryAfterHeader: string | null): number {
  const seconds = Number(retryAfterHeader) || 2;
  return (seconds + 0.5) * 1000;
}
