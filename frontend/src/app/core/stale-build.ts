/**
 * A tab that was open when the site was deployed (11 Sep 2026; the rule itself is older).
 *
 * Every chunk this app loads lazily is content-hashed (`outputHashing: "all"`), and GitHub Pages
 * redeploys on every push touching `frontend/**` — dozens of times on a working day. So a browser
 * tab left open across a deploy still asks for chunk names that no longer exist, the fetch 404s,
 * and whatever was being loaded silently does not arrive.
 *
 * `App` has recovered from this on a route since 25 Aug 2026, but only on a route: a `@defer`
 * block's failure never reaches the router at all. On 11 Sep 2026 that difference put a teammate
 * behind a blank full-screen scrim — the review takeover's backdrop renders eagerly while every
 * piece of its content, and both of its exits, live inside a deferred block — with `NG0750`
 * (Angular's `DEFER_LOADING_FAILED`) the only trace. Hence one shared rule, read from both places.
 */

/** The shapes a browser uses to say a lazy chunk did not load. Chrome, Firefox and Safari each word it differently. */
const CHUNK_FAILURE = /dynamically imported module|ChunkLoadError|Loading chunk|Importing a module script failed|error loading dynamically imported module/i;

/**
 * Is this the failure of a lazy chunk rather than a fault in our own code? Takes whatever the
 * caller was handed — an `Error`, a string, a router event's `error` — because a rejected dynamic
 * import is not typed anywhere it arrives from.
 */
export function isStaleChunkError(err: unknown): boolean {
  if (!err) return false;
  const said = typeof err === 'string' ? err : String((err as { message?: string }).message ?? err);
  return CHUNK_FAILURE.test(said);
}

/** Where the one-reload-per-target guard is kept. Session-scoped: a new tab gets a fresh try. */
const RELOAD_KEY = 'bom-stale-build-reload';

/**
 * Reload once for this target and never twice, and say whether it is reloading.
 *
 * The guard is the point. If the chunk is genuinely missing — a half-finished deploy, a cache
 * serving an index that names files it does not have — reloading on every failure is an infinite
 * refresh loop on a page the user cannot read or leave, which is worse than the blank screen it is
 * trying to cure. `target` is what is being recovered (a route url, or the name of a deferred
 * block), so a second, different failure in the same session still gets its one reload.
 */
export function reloadForStaleBuild(target: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null, reload: () => void): boolean {
  if (!storage) return false;
  let seen: string | null = null;
  try {
    seen = storage.getItem(RELOAD_KEY);
  } catch {
    // Private mode, or storage the browser refuses. A reload we cannot remember is a reload we
    // cannot guarantee to stop, so we do not start one.
    return false;
  }
  if (seen === target) return false;
  try {
    storage.setItem(RELOAD_KEY, target);
  } catch {
    return false;
  }
  reload();
  return true;
}
