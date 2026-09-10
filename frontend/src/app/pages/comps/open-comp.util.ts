import { Comp } from '../../models/team.models';

/**
 * Which comp a link's `?comp=<id>` opens, given the comps the page holds (10
 * Sep 2026): the film's draft chapter lands on the Comps page this way after
 * saving a variant, or to show the comp we played.
 *
 * `null` means do nothing yet, or at all. No id: nothing was asked. An id the
 * list does not carry: either the list has not arrived (the page's effect runs
 * again when it does) or the comp was deleted, and in both cases the card
 * stays folded and the param is left alone, which is honest about what
 * happened. Only an id the list carries is opened, so the page never holds a
 * panel open for a comp that is not there.
 */
export function compToOpen(wanted: string | null | undefined, comps: readonly Pick<Comp, 'id'>[]): string | null {
  if (!wanted) return null;
  return comps.some((c) => c.id === wanted) ? wanted : null;
}

/** How the card is brought into view: no glide when the reader asked for stillness, as the film scrolls. */
export function revealBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : 'smooth';
}
