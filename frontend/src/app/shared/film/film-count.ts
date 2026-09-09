import { MotionService } from '../../services/motion.service';

/** Stops a count that has not started yet; one already rolling stops on its own once its element leaves the page. */
export type CancelCount = () => void;

/**
 * Count a figure up from zero (the film room, 9 Sep 2026). The template
 * binds the real figure to the element's `data-count` and leaves its text
 * alone, so the counter is the only thing that ever writes there and
 * Angular never fights it; this reads the target, keeps whatever follows the
 * digits ("34 min"), and counts to it through `MotionService.count`, scaled
 * by the film's tempo. An element without `data-count` counts whatever text
 * it holds. With motion off the number simply stands. Returns a cancel for
 * the wait before a staggered count starts.
 */
export function countText(motion: MotionService, el: Element, ms: number, delay = 0): CancelCount {
  const host = el as HTMLElement;
  const text = host.dataset?.['count'] ?? el.textContent ?? '';
  const m = /^(\d+)([\s\S]*)$/.exec(text.trim());
  if (!m) return () => undefined;
  const to = Number(m[1]);
  const suffix = m[2];
  const format = (n: number) => `${Math.round(n)}${suffix}`;
  const tempo = motion.tempo(el);
  if (motion.reduced() || delay <= 0) {
    void motion.count(el, 0, to, ms * tempo, format);
    return () => undefined;
  }
  // Held at zero until its turn, so a staggered row reads as a wave rather than a pop.
  el.textContent = format(0);
  const timer = setTimeout(() => void motion.count(el, 0, to, ms * tempo, format), delay * tempo);
  return () => clearTimeout(timer);
}

/** Count every element in turn, `stagger` ms apart, the first one `after` ms in; the cancel stops every wait still pending. */
export function countAll(motion: MotionService, els: readonly Element[], ms: number, stagger = 60, after = 0): CancelCount {
  const cancels = els.map((el, i) => countText(motion, el, ms, after + i * stagger));
  return () => cancels.forEach((cancel) => cancel());
}
