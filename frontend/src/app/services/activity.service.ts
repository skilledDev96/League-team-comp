import { Injectable, computed, inject, signal } from '@angular/core';
import { ToastService } from './toast.service';

export interface ActivityJob {
  readonly id: number;
  /** What is running, e.g. "Refreshing match analysis". */
  readonly label: string;
  /** Where it is, e.g. "Rulukuku (3/5)". Updated as the job goes. */
  readonly detail: string;
  readonly startedAt: number;
}

export interface ActivityHandle {
  /** Replace the progress line. */
  readonly progress: (detail: string) => void;
  /** Take the job off the board. Idempotent. */
  readonly end: () => void;
}

/**
 * Everything the app is fetching right now, in one place.
 *
 * Every Riot-backed job takes a minute or more — the key allows a hundred
 * calls per two minutes and a single player costs about fifty — and most of
 * them are started from one page and finished on another. The state used to
 * live on the page that started it, so leaving the page made the job vanish
 * from view while it kept running, and coming back showed a button that looked
 * idle over a run that was still going. Clicking it again ran the whole thing
 * twice against the same rate limit.
 *
 * Root services register their runs here; the topbar shows whatever is on the
 * board wherever you are, and any button can ask whether its own job is live.
 */
@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly toast = inject(ToastService);

  readonly jobs = signal<readonly ActivityJob[]>([]);
  readonly busy = computed(() => this.jobs().length > 0);
  /** The oldest job — the one the topbar names; the rest are a count. */
  readonly primary = computed<ActivityJob | null>(() => this.jobs()[0] ?? null);
  readonly others = computed(() => Math.max(this.jobs().length - 1, 0));

  private nextId = 1;

  begin(label: string, detail = ''): ActivityHandle {
    const id = this.nextId++;
    this.jobs.update((list) => [...list, { id, label, detail, startedAt: Date.now() }]);
    return {
      progress: (next: string) =>
        this.jobs.update((list) => list.map((j) => (j.id === id ? { ...j, detail: next } : j))),
      end: () => this.jobs.update((list) => list.filter((j) => j.id !== id))
    };
  }

  /**
   * Run a job on the board, with the option of a notice when it lands.
   *
   * The notice is for jobs that outlive the page: a person who kicked off the
   * analysis and went to read scouting should not have to go back to find out
   * it finished. Failures are always announced — a silent failure on another
   * page is how a run "just never came back".
   */
  async run<T>(
    label: string,
    work: (handle: ActivityHandle) => Promise<T>,
    options: { notify?: string; detail?: string } = {}
  ): Promise<T> {
    const handle = this.begin(label, options.detail ?? '');
    try {
      const result = await work(handle);
      if (options.notify) {
        this.toast.show(options.notify, { kind: 'ok', icon: 'check_circle' });
      }
      return result;
    } catch (error) {
      this.toast.show(`${label} failed`, {
        kind: 'warn',
        icon: 'error',
        text: error instanceof Error ? error.message : 'Unknown error',
        timeout: 10000
      });
      throw error;
    } finally {
      handle.end();
    }
  }

  /** Whether a job whose label starts with this text is running. */
  has(labelPrefix: string): boolean {
    return this.jobs().some((j) => j.label.startsWith(labelPrefix));
  }
}
