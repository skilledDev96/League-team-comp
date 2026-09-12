import { Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { prefersSaveData } from '../../core/save-data';
import { MotionService } from '../../services/motion.service';
import { UiService } from '../../services/ui.service';

/**
 * A champion in motion behind a chapter of the film (9 Sep 2026): the short
 * muted clip Riot's champion pages play for one ability, over the splash.
 * The splash is always there and shows at once; the clip is fetched only
 * when this instance is `active` (the page passes that to the current
 * chapter alone, so one clip loads at a time), fades in on its first frame
 * and fades back out when the chapter is left, so the poster is what stays.
 * Motion off, Save-Data, an index that does not know the champion, a browser
 * that cannot play either container, or a clip that fails: the splash alone,
 * with its slow pan, and nothing flashes. The page never waits on a clip.
 *
 * Only our own champions come through here: the protagonist and our seats.
 */
@Component({
  selector: 'app-champion-motion',
  host: { class: 'film-motion' },
  template: `
    @let art = ui.championArtUrl(champion());
    <img class="film-splash" [src]="art" (error)="ui.artFallback($event, champion())" alt="" />
    @if (clip(); as c) {
      @if (!failed()) {
        <video #video class="film-clip" [class.is-on]="playing()" [muted]="true" loop playsinline preload="none" disablepictureinpicture disableremoteplayback
               (error)="fail()" (playing)="playing.set(true)" (pause)="playing.set(false)" aria-hidden="true">
          <source [src]="c.webm" type="video/webm" />
          <source [src]="c.mp4" type="video/mp4" (error)="fail()" />
        </video>
      }
    }
    @if (shade()) { <span [class]="shade()" aria-hidden="true"></span> }
  `
})
export class ChampionMotionComponent {
  readonly champion = input.required<string>();
  readonly slot = input<'P' | 'Q' | 'W' | 'E' | 'R'>('R');
  /** Only the current chapter's clip plays; the rest keep their poster and never fetch. */
  readonly active = input<boolean>(false);
  /** A class for the overlay drawn over the art, so each chapter shades it its own way. */
  readonly shade = input<string>('');

  protected readonly ui = inject(UiService);
  private readonly motion = inject(MotionService);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  /** Set for good once a clip cannot load or play: the splash stays. */
  protected readonly failed = signal(false);
  protected readonly playing = signal(false);
  protected readonly clip = computed(() => this.ui.championClipUrls(this.champion(), this.slot()));
  private readonly wants = computed(() => this.active() && !this.motion.reduced() && !prefersSaveData() && !!this.clip() && !this.failed());

  /** Which clip the video element has been pointed at, so a new champion on the same instance reloads it. */
  private loaded = '';

  constructor() {
    effect(() => {
      const el = this.video()?.nativeElement;
      const on = this.wants();
      const src = this.clip()?.webm ?? '';
      if (!el) return;
      untracked(() => {
        if (this.loaded && this.loaded !== src && typeof el.load === 'function') {
          this.playing.set(false);
          el.load();
        }
        this.loaded = src;
        if (on) this.start(el);
        else this.stop(el);
      });
    });

    // A layer that leaves the page (a seat crossfaded away, a chapter left) must stop decoding, not just stop showing.
    inject(DestroyRef).onDestroy(() => {
      const el = this.video()?.nativeElement;
      if (!el) return;
      this.stop(el);
      for (const source of Array.from(el.querySelectorAll('source'))) source.removeAttribute('src');
      if (typeof el.load === 'function') el.load();
    });
  }

  private start(el: HTMLVideoElement): void {
    if (typeof el.canPlayType === 'function' && !el.canPlayType('video/webm') && !el.canPlayType('video/mp4')) {
      this.fail();
      return;
    }
    el.muted = true;
    try {
      const p = el.play();
      // An AbortError is the browser saying a pause or a new load overtook this play: not a clip that cannot play.
      if (p && typeof p.then === 'function') p.then(undefined, (err: unknown) => (isAbort(err) ? undefined : this.fail()));
    } catch {
      this.fail();
    }
  }

  private stop(el: HTMLVideoElement): void {
    this.playing.set(false);
    if (!el.paused && typeof el.pause === 'function') el.pause();
  }

  protected fail(): void {
    this.failed.set(true);
    this.playing.set(false);
  }
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}
