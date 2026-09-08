import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { anchorSelectors, canRun, dueTours, isSeen, roleOf, routeMatches, stepAfterSkip, stepsFor, Tour, tourById, TourNeed, TOURS, TourStep } from '../core/tours';
import { AuthService } from './auth.service';
import { PlayerEditorService } from './player-editor.service';
import { TeamDataService } from './team-data.service';
import { UserPrefsService } from './user-prefs.service';

/**
 * Runs a tour: walks the page to each step's anchor, turning edit mode on
 * or changing route and tab where a step needs it, and keeps the anchor's
 * rectangle up to date for the overlay.
 *
 * Two rules keep it harmless: a missing anchor skips the step and never
 * throws (the e2e console sweep runs on every page), and nothing here is
 * rendered — the overlay is a top-layer component at the app root.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly data = inject(TeamDataService);
  private readonly prefs = inject(UserPrefsService);
  private readonly editor = inject(PlayerEditorService);

  readonly active = signal<Tour | null>(null);
  readonly steps = signal<TourStep[]>([]);
  readonly index = signal(0);
  readonly anchorRect = signal<DOMRect | null>(null);
  readonly busy = signal(false);
  readonly helpOpen = signal(false);
  readonly url = signal('/');

  readonly step = computed(() => this.steps()[this.index()] ?? null);
  readonly role = computed(() => roleOf({ canEdit: this.auth.canEdit(), canManageUsers: this.auth.canManageUsers() }));
  /** Every tour this role may run, for the help list. */
  readonly available = computed(() => TOURS.filter((t) => t.steps.length > 0 && canRun(t, this.role()) && stepsFor(t, this.role()).length > 0));

  private anchorEl: HTMLElement | null = null;
  private editModeBefore: boolean | null = null;
  private missing = new Set<number>();
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private lastAutoUrl = '';
  /** True while the tour itself is navigating, so its own NavigationEnd does not end it. */
  private walking = false;

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.url.set(e.urlAfterRedirects);
      // Leaving the page mid-tour ends it: an overlay that follows you to
      // another page, hunting for an anchor that is not there, is worse than
      // no tour. The tour's own navigation sets `walking` first.
      if (this.active() && !this.walking) {
        this.finish();
        return;
      }
      this.maybeAutoStart();
    });
    effect(() => {
      // The first page: the router has settled before the data and prefs have.
      this.auth.ready();
      this.data.ready();
      this.prefs.loaded();
      untracked(() => this.maybeAutoStart());
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.measure());
      window.addEventListener('scroll', () => this.measure(), { capture: true, passive: true });
    }
  }

  // ---- Which tour, and whether it is due ------------------------------------------

  seen(tour: Tour): boolean {
    return isSeen({ [tour.id]: this.prefs.seenVersion(tour.id) }, tour);
  }

  /** The tour this page belongs to, for the pill; null when there is none for this role. */
  pillFor(url: string): Tour | null {
    return this.available().find((t) => routeMatches(t.match, url)) ?? null;
  }

  /** Why a tour cannot run right now, in words for the pill's tip; null when it can. */
  blocker(tour: Tour): string | null {
    if (!tour.needs) return null;
    if (this.have()[tour.needs]) return null;
    switch (tour.needs) {
      case 'players':
        return 'Add a player first (Admin → Players).';
      case 'comps':
        return 'Add a comp first.';
      case 'series':
        return 'Add a series on the Plan view first.';
      case 'analysis':
        return 'Refresh matches from Riot first.';
      case 'scrims':
        return 'Drop a replay first.';
    }
  }

  private have(): Partial<Record<TourNeed, boolean>> {
    return {
      players: this.data.players().length > 0,
      comps: this.data.comps().length > 0,
      series: this.data.tournamentSeries().length > 0,
      analysis: !!this.data.compAnalysis(),
      scrims: this.data.scrims().length > 0
    };
  }

  private maybeAutoStart(): void {
    if (this.active() || !this.auth.ready() || !this.auth.isAuthed() || !this.prefs.loaded() || !this.data.ready()) return;
    const url = this.url();
    if (this.lastAutoUrl === url) return;
    const seen: Record<string, number> = {};
    for (const t of TOURS) seen[t.id] = this.prefs.seenVersion(t.id);
    const due = dueTours(TOURS, seen, this.role(), url, this.have());
    if (!due.length) return;
    this.lastAutoUrl = url;
    setTimeout(() => {
      if (!this.active()) void this.start(due[0].id);
    }, 600);
  }

  // ---- Running one ------------------------------------------------------------------

  async start(id: string): Promise<boolean> {
    const tour = tourById(id);
    if (!tour) return false;
    const steps = stepsFor(tour, this.role());
    if (!steps.length || this.blocker(tour)) return false;
    this.helpOpen.set(false);
    // Started from the help list on another page: go to the tour's page
    // first. A prefix match (the player profile) opens the first player.
    if (!routeMatches(tour.match, this.url())) {
      const path = tour.match.path.endsWith('/') ? `${tour.match.path}${this.data.players()[0]?.id ?? ''}` : tour.match.path;
      this.walking = true;
      try {
        await this.router.navigate([path], { queryParams: tour.match.query ?? {} });
        await this.pause(150);
      } finally {
        this.walking = false;
      }
    }
    this.lastAutoUrl = this.url();
    this.active.set(tour);
    this.steps.set(steps);
    this.missing = new Set();
    this.editModeBefore = null;
    await this.goTo(0, 1);
    return true;
  }

  async next(): Promise<void> {
    // One step at a time: a second press while the first is still walking
    // the page would start two hunts for two anchors at once.
    if (this.busy()) return;
    const i = stepAfterSkip(this.steps().length, this.index(), 1, this.missing);
    if (i === null) this.finish();
    else await this.goTo(i, 1);
  }

  async back(): Promise<void> {
    if (this.busy()) return;
    const i = stepAfterSkip(this.steps().length, this.index(), -1, this.missing);
    if (i !== null) await this.goTo(i, -1);
  }

  skip(): void {
    this.finish();
  }

  /** Done, or skipped: both count as seen. The help list runs it again any time. */
  finish(): void {
    const tour = this.active();
    if (!tour) return;
    void this.prefs.markTourSeen(tour.id, tour.version);
    if (this.editModeBefore === false) this.auth.editMode.set(false);
    this.clear();
  }

  private clear(): void {
    this.active.set(null);
    this.steps.set([]);
    this.index.set(0);
    this.anchorRect.set(null);
    this.anchorEl = null;
    this.observer?.disconnect();
    this.observer = null;
    this.busy.set(false);
  }

  private async goTo(i: number, dir: 1 | -1): Promise<void> {
    const tour = this.active();
    const step = this.steps()[i];
    if (!tour || !step) return;
    this.busy.set(true);
    this.index.set(i);
    this.anchorRect.set(null);
    try {
      await this.settle(tour, step);
      const el = await this.waitFor(step);
      if (!el) {
        this.missing.add(i);
        const nextI = stepAfterSkip(this.steps().length, i, dir, this.missing);
        if (nextI === null) {
          if (dir === 1) this.finish();
          else this.busy.set(false);
          return;
        }
        await this.goTo(nextI, dir);
        return;
      }
      await this.reveal(el);
      this.attach(el);
    } catch (err) {
      console.warn('Tour step skipped', tour.id, step.anchor, err);
      this.missing.add(i);
    } finally {
      if (this.active()) this.busy.set(false);
    }
  }

  /** Put the page in the state the step needs: route, query, edit mode, a named action. */
  private async settle(tour: Tour, step: TourStep): Promise<void> {
    const route = step.route ?? tour.match.path;
    const query = step.query ?? (step.route ? {} : (tour.match.query ?? {}));
    const target = route.endsWith('/') ? null : route;
    if (target) {
      const current = this.router.url.split('?')[0];
      const params = new URLSearchParams(this.router.url.split('?')[1] ?? '');
      const queryDiffers = Object.entries(query).some(([k, v]) => params.get(k) !== v);
      if (current !== target || queryDiffers) {
        this.walking = true;
        try {
          await this.router.navigate([target], { queryParams: query, queryParamsHandling: Object.keys(query).length ? 'merge' : undefined });
          await this.pause(80);
        } finally {
          this.walking = false;
        }
      }
    }
    if (step.editMode && this.auth.canEdit() && !this.auth.editMode()) {
      if (this.editModeBefore === null) this.editModeBefore = this.auth.editMode();
      this.auth.editMode.set(true);
      await this.pause(60);
    }
    if (step.before) await this.action(step.before);
  }

  private async action(name: string): Promise<void> {
    switch (name) {
      case 'openUserMenu': {
        const trigger = document.querySelector<HTMLElement>('[data-tour="user-menu-trigger"]');
        if (trigger && !document.querySelector('.user-menu-panel')) trigger.click();
        await this.pause(60);
        return;
      }
      case 'openCompMore': {
        document.querySelector<HTMLElement>('details.comp-more')?.setAttribute('open', '');
        await this.pause(40);
        return;
      }
      case 'openPlayerEditor': {
        // The profile's player, from the URL; the drawer is the editor.
        const id = decodeURIComponent(this.url().split('?')[0].replace(/^\/player\//, ''));
        if (id && !this.editor.drawerDraft()) {
          this.editor.open(id);
          await this.pause(250);
        }
        return;
      }
      case 'clickScout': {
        // The scouting panel is behind the series' Scout button.
        if (!document.querySelector('.series-prep')) {
          document.querySelector<HTMLElement>('[data-tour="plan-scout-btn"]')?.click();
          await this.pause(450);
        }
        return;
      }
      default:
        return;
    }
  }

  private async waitFor(step: TourStep): Promise<HTMLElement | null> {
    const selectors = anchorSelectors(step);
    for (let tries = 0; tries < 30; tries += 1) {
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) continue;
        // An anchor inside a closed row has no box until the row is open;
        // open the way to it first, then ask whether it is visible.
        this.openAncestors(el);
        if (el.getClientRects().length && !el.closest('[hidden]')) return el;
      }
      await this.pause(100);
    }
    return null;
  }

  private openAncestors(el: HTMLElement): void {
    let parent: HTMLElement | null = el;
    while ((parent = parent.parentElement)) {
      if (parent instanceof HTMLDetailsElement && !parent.open) parent.open = true;
    }
  }

  /**
   * Bring the anchor on screen. A row's body renders a tick after the row
   * opens, so the scroll waits for that; and a smooth scroll can be cut
   * short, so the position is checked afterwards and corrected outright.
   */
  private async reveal(el: HTMLElement): Promise<void> {
    this.openAncestors(el);
    await this.pause(150);
    const smooth = !prefersReducedMotion();
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    await this.pause(smooth ? 450 : 50);
    const box = el.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      await this.pause(50);
    }
  }

  private attach(el: HTMLElement): void {
    this.anchorEl = el;
    this.observer?.disconnect();
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.measure());
    this.observer?.observe(el);
    this.measure();
  }

  measure(): void {
    if (!this.anchorEl) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.anchorEl) return;
      if (!this.anchorEl.isConnected) {
        this.anchorRect.set(null);
        return;
      }
      this.anchorRect.set(this.anchorEl.getBoundingClientRect());
    });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
