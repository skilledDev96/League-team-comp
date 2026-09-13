import { Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { HomeNextSeries, HomeRecord, HomeSlide } from '../../core/home-model';
import { SettingsBanner } from '../../models/team.models';
import { prefersSaveData } from '../../core/save-data';
import { SeasonMode, SeasonWindow } from '../../core/team-season';
import { InViewDirective } from '../../shared/in-view.directive';
import { TooltipDirective } from '../../shared/tooltip.directive';
import { MotionService } from '../../services/motion.service';
import { PageVisibilityService } from '../../services/page-visibility.service';
import { TourService } from '../../services/tour.service';
import { UiService } from '../../services/ui.service';
import { CountUpDirective } from './count-up.directive';
import { HomeNextSeriesComponent } from './home-next-series.component';
import { CROSSFADE_MS, dropFailed, nextIndex, ROTATE_MS, rotationFor } from './splash-rotation';

interface SplashLayer {
  key: number;
  champion: string;
  /** Came in over the one before it, so it fades in; the first splash of the page is simply there. */
  incoming: boolean;
}

interface Counter {
  key: string;
  label: string;
  value: number | null;
  suffix: string;
  sub: string;
}

const sameChampion = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Separates the champion from the skin in the banner's slide key; no champion name holds it. */
const BANNER_MARK = '#skin';

function parseBanner(key: string): { champion: string; skin: number } | null {
  const at = key.indexOf(BANNER_MARK);
  if (at < 0) return null;
  return { champion: key.slice(0, at), skin: Number(key.slice(at + BANNER_MARK.length)) || 0 };
}

/**
 * The top of the home page (13 Sep 2026): the team's name over our five starters' mains, the season's
 * counters, the season switch, the Motion pill and the next series.
 *
 * The splash is two layers at most. The page opens on one (seeded by the day, fetched eagerly with high
 * priority) and, every `ROTATE_MS`, fetches and decodes the next before laying it over the first, so a
 * crossfade never shows a half-drawn picture; the old layer goes once the new one is in. It rotates only
 * while motion is on, the browser has not asked to save data, the tab is looked at and the hero is on
 * screen. A splash CommunityDragon does not have is asked of Data Dragon, and a champion neither has is
 * dropped from the rotation rather than shown as a hole.
 */
@Component({
  selector: 'app-home-hero',
  imports: [CountUpDirective, HomeNextSeriesComponent, InViewDirective, TooltipDirective],
  template: `
    <section class="home-hero" data-tour="home-hero" appInView [appInViewOnce]="false" (firstSeen)="seen.set(true)" (inView)="visible.set($event)">
      <div class="home-hero-art" aria-hidden="true">
        @for (layer of layers(); track layer.key) {
          <img class="home-hero-slide" [class.is-incoming]="layer.incoming" [src]="urlOf(layer.champion)" alt=""
               [attr.fetchpriority]="!layer.incoming ? 'high' : null" (error)="splashFailed(layer.champion)" />
        }
        <span class="home-hero-shade"></span>
      </div>

      <div class="home-hero-top">
        <p class="home-kicker home-hero-kicker">
          <span class="material-symbols-rounded" aria-hidden="true">{{ season().mode === 'all' ? 'all_inclusive' : 'event_available' }}</span>
          {{ season().label }}
        </p>
        <div class="home-hero-tools">
          @if (tour(); as t) {
            <button type="button" class="view-btn home-pill" [disabled]="!!tours.blocker(t)" [appTip]="tours.blocker(t) || t.blurb" (click)="tours.start(t.id)">
              <span class="material-symbols-rounded" aria-hidden="true">tour</span> Show me around
            </button>
          }
          <div class="view-segment home-season" role="group" aria-label="Which games the page counts">
            <button type="button" [class.active]="mode() === 'all'" [attr.aria-pressed]="mode() === 'all'" (click)="modeChange.emit('all')">All time</button>
            <button type="button" [class.active]="mode() === 'season'" [attr.aria-pressed]="mode() === 'season'" [appTip]="seasonTip()" (click)="modeChange.emit('season')">{{ seasonWord() }}</button>
          </div>
          <button type="button" class="view-btn home-pill home-motion" [class.active]="motion.reduced()" [attr.aria-pressed]="motion.reduced()"
                  [appTip]="motion.reduced() ? 'Motion is off on this screen: the splash holds still and the figures stand' : 'Turn the motion off on this screen'"
                  (click)="motion.setStill(!motion.reduced())">
            <span class="material-symbols-rounded" aria-hidden="true">{{ motion.reduced() ? 'motion_photos_off' : 'motion_photos_on' }}</span>
            {{ motion.reduced() ? 'Still' : 'Motion' }}
          </button>
        </div>
      </div>

      <div class="home-hero-body">
        <h1 class="home-title">{{ teamName() }}</h1>
        @if (motto()) {
          <p class="home-motto">{{ motto() }}</p>
        }
        <p class="home-hero-caption">
          @if (caption(); as c) { <span class="material-symbols-rounded" aria-hidden="true">photo_camera</span> {{ c }} }
        </p>

        <dl class="home-counters">
          @for (c of counters(); track c.key) {
            <div class="home-counter">
              <dt>{{ c.label }}</dt>
              <dd>
                <span class="home-counter-figure" aria-hidden="true" [appCountUp]="c.value" [countUpSuffix]="c.suffix" [countUpGo]="seen()"></span>
                <span class="visually-hidden">{{ c.value === null ? 'None yet' : c.value + c.suffix }}</span>
                <small class="home-counter-sub">{{ c.sub }}</small>
              </dd>
            </div>
          }
        </dl>
        @if (!record().counters.games) {
          <p class="home-hero-empty">The record starts with the first game on the Games page.</p>
        }
      </div>

      <app-home-next-series class="home-hero-next" [next]="next()" />
    </section>
  `
})
export class HomeHeroComponent {
  readonly teamName = input.required<string>();
  readonly motto = input('');
  /** Settings' banner: the first splash, before the mains. */
  readonly banner = input<SettingsBanner | null>(null);
  readonly season = input.required<SeasonWindow>();
  /** "This season" while a tournament runs, else "Last 90 days". */
  readonly seasonWord = input.required<string>();
  readonly mode = input.required<SeasonMode>();
  readonly slides = input.required<readonly HomeSlide[]>();
  readonly record = input.required<HomeRecord>();
  readonly next = input<HomeNextSeries | null>(null);
  readonly modeChange = output<SeasonMode>();
  /** The running tournament's name, for the season button's tip. */
  readonly seasonName = input('');

  protected readonly seasonTip = computed(() => (this.seasonName() ? `Only the games of ${this.seasonName()}` : 'Only the games of the last 90 days'));

  protected readonly motion = inject(MotionService);
  private readonly ui = inject(UiService);
  private readonly visibility = inject(PageVisibilityService);
  protected readonly tours = inject(TourService);
  /** The page's own tour, the welcome, offered here rather than through the page toolbar Home does not have. */
  protected readonly tour = computed(() => (this.tours.active() ? null : this.tours.pillFor(this.tours.url())));

  protected readonly seen = signal(false);
  protected readonly visible = signal(false);

  /** The day's seed, so the page opens on the same champion all day and on another tomorrow. */
  private readonly daySeed = new Date().toDateString();
  /** The banner's key: the champion and the skin together, so a banner on a main's skin is not mistaken for the main's own slide. */
  private readonly bannerKey = computed(() => {
    const b = this.banner();
    return b ? `${b.champion}${BANNER_MARK}${b.skin ?? 0}` : '';
  });
  private readonly rotation = computed(() => {
    const keys = [this.bannerKey(), ...this.slides().map((s) => s.champion)];
    const rotation = rotationFor(keys, { still: this.motion.reduced(), saveData: prefersSaveData(), daySeed: this.daySeed });
    // A banner is where the page opens, every day, and the day's seed only picks among the mains.
    return this.bannerKey() ? { ...rotation, start: 0 } : rotation;
  });
  private readonly failed = signal<ReadonlySet<string>>(new Set());
  private readonly list = computed(() => dropFailed(this.rotation().slides, this.failed()));
  /** Champions whose CommunityDragon splash failed, so they are asked of Data Dragon. */
  private readonly fallbacks = signal<ReadonlySet<string>>(new Set());
  private readonly index = signal(0);
  protected readonly layers = signal<SplashLayer[]>([]);
  private generation = 0;
  private destroyed = false;

  protected readonly caption = computed(() => {
    const front = this.layers().at(-1);
    if (!front) return '';
    const banner = parseBanner(front.champion);
    if (banner) return this.ui.championName(banner.champion);
    const slide = this.slides().find((s) => sameChampion(s.champion, front.champion));
    const champion = this.ui.championName(front.champion);
    return slide ? `${slide.player} on ${champion}` : champion;
  });

  protected readonly counters = computed<Counter[]>(() => {
    const c = this.record().counters;
    const played = c.games > 0;
    const run = this.record().current;
    return [
      { key: 'wins', label: 'Wins', value: played ? c.wins : null, suffix: '', sub: played ? `${c.losses} lost` : '' },
      { key: 'rate', label: 'Win rate', value: played ? c.winRate : null, suffix: '%', sub: run && run.result === 'win' && run.length > 1 ? `${run.length} wins in a row` : '' },
      { key: 'series', label: 'Series won', value: c.seriesPlayed ? c.seriesWon : null, suffix: '', sub: c.seriesPlayed ? `of ${c.seriesPlayed} finished` : '' },
      { key: 'games', label: 'Games', value: played ? c.games : null, suffix: '', sub: '' }
    ];
  });

  constructor() {
    // Put a splash up, and put another up when the one showing leaves the list (it failed twice, or the
    // team's data landed and the mains changed).
    effect(() => {
      const list = this.list();
      untracked(() => {
        const front = this.layers().at(-1);
        if (!list.length) {
          if (front) this.layers.set([]);
          return;
        }
        if (front && list.some((c) => sameChampion(c, front.champion))) return;
        const at = front ? this.index() % list.length : this.rotation().start % list.length;
        this.index.set(at);
        this.layers.set([{ key: ++this.generation, champion: list[at], incoming: false }]);
      });
    });

    // One timer at a time, restarted after every change of slide.
    effect((onCleanup) => {
      this.index();
      const go = this.rotation().rotate && this.list().length > 1 && this.visible() && this.visibility.visible() && !this.motion.reduced();
      if (!go) return;
      const timer = setTimeout(() => void this.advance(), ROTATE_MS);
      onCleanup(() => clearTimeout(timer));
    });

    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  /** A main's splash from CommunityDragon, then Data Dragon; the banner's skin from Data Dragon, then the champion's base splash. */
  protected urlOf(key: string): string {
    const banner = parseBanner(key);
    if (banner && banner.skin > 0) {
      return this.fallbacks().has(key) ? this.ui.championArtUrl(banner.champion) : this.ui.championSkinSplashUrl(banner.champion, banner.skin);
    }
    const champion = banner?.champion ?? key;
    return this.fallbacks().has(key) ? this.ui.championSplashFallbackUrl(champion) : this.ui.championArtUrl(champion);
  }

  /** A splash that would not load: Data Dragon next, and out of the rotation when that fails too. */
  protected splashFailed(champion: string): void {
    if (!this.fallbacks().has(champion)) {
      this.fallbacks.update((set) => new Set([...set, champion]));
    } else {
      this.failed.update((set) => new Set([...set, champion]));
    }
  }

  private async advance(): Promise<void> {
    const list = this.list();
    if (list.length < 2) return;
    const at = nextIndex(this.index(), list.length);
    const champion = list[at];
    let ok = await decoded(this.urlOf(champion));
    if (!ok && !this.fallbacks().has(champion)) {
      this.fallbacks.update((set) => new Set([...set, champion]));
      ok = await decoded(this.urlOf(champion));
    }
    if (this.destroyed) return;
    if (!ok) {
      this.failed.update((set) => new Set([...set, champion]));
      return;
    }
    const key = ++this.generation;
    this.layers.update((layers) => [...layers.slice(-1), { key, champion, incoming: true }]);
    this.index.set(at);
    // The layer underneath goes once the new one has faded in over it.
    setTimeout(() => {
      if (!this.destroyed) this.layers.update((layers) => layers.filter((l) => l.key >= key));
    }, CROSSFADE_MS + 100);
  }
}

/** Fetch and decode a picture before it is shown, so a crossfade never reveals a half-drawn one. */
function decoded(url: string): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const done = () => resolve(true);
      if (typeof img.decode === 'function') img.decode().then(done, done);
      else done();
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
