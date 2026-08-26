/**
 * Firestore rejects `undefined` outright — `setDoc` throws rather than skipping
 * the field — so anything on its way to a document has to be cleaned first.
 * Optional model fields are left off all over the app, and a spread of a
 * partially-filled draft carries them through as `undefined`.
 *
 * Kept separate from the service so it can be exercised directly.
 */
export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result = {} as T;

  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) {
      continue;
    }
    result[key as keyof T] = clean(val) as T[keyof T];
  }

  return result;
}

/**
 * Arrays are walked as well as objects. An array of champion names passes
 * through untouched, but an array of objects — play tokens, analysis games —
 * would otherwise smuggle an `undefined` field past the cleaning and be
 * rejected on write.
 *
 * `undefined` *elements* are deliberately left alone: dropping one would shift
 * every index after it, and picks are stored by position.
 */
function clean(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map((item) => clean(item));
  }
  if (val && typeof val === 'object') {
    return stripUndefined(val as Record<string, unknown>);
  }
  return val;
}
