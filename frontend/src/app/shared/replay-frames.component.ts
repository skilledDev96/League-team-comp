import { afterRenderEffect, Component, computed, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { ReplayRecording, ReplayShot, ReplayShotRef } from '../models/team.models';
import { ReplayRecordingService, shotSrc } from '../services/replay-recording.service';
import { TooltipDirective } from './tooltip.directive';

/**
 * Pictures read without being asked for, when a row's drawer opens. A strip
 * thumbnail is 9rem wide, so a desktop drawer has eight or nine of them on
 * screen at once and each is a few hundred kilobytes — four is enough to show
 * the strip is real, and the rest come as the reader scrolls or taps.
 */
const EAGER_SHOTS = 4;

/**
 * The recorder's frames for one game (10 Sep 2026).
 *
 * A tournament or scrim game is invisible to Riot's API, so the local
 * recorder walks the replay in the League client and takes a real picture of
 * our own game at each death and each objective. They are stored one
 * document a picture, a few hundred kilobytes each, which is why nothing is
 * read here until it is needed: the recording when the row's drawer opens,
 * and a picture when its thumbnail scrolls into view or is tapped. Twenty at
 * once would be twenty Firestore reads for a row nobody has looked at yet.
 *
 * Everything on it is our own game. The other team is a champion in a seat:
 * a frame's label never carries a name, a Riot id or a puuid of theirs.
 */
@Component({
  selector: 'app-replay-frames',
  imports: [TooltipDirective],
  host: { class: 'replay-frames-host', '(keydown)': 'onKey($event)' },
  template: `
    @if (recording(); as rec) {
      <div class="replay-frames">
        <p class="muted rf-note">Frames from the replay, recorded on {{ recordedOn(rec) }}; positions are what the minimap shows.</p>
        @if (shots().length) {
          <div class="rf-strip" #strip (pointerdown)="touched()" (scroll)="touched()" (focusin)="touched()">
            @for (s of shots(); track s.docId; let i = $index) {
              <button
                type="button"
                class="rf-shot"
                [attr.data-doc]="s.docId"
                [class.is-open]="i === at()"
                [appTip]="s.label"
                (click)="openAt(i)"
              >
                <span class="rf-thumb">
                  @if (picture(s.docId); as shot) {
                    <img class="rf-thumb-img" [src]="src(shot)" [alt]="s.label" />
                  } @else if (picture(s.docId) === null) {
                    <span class="material-symbols-rounded" aria-hidden="true">image_not_supported</span>
                  } @else if (asked().has(s.docId)) {
                    <span class="btn-spinner" aria-hidden="true"></span>
                  } @else {
                    <span class="material-symbols-rounded" aria-hidden="true">photo_camera</span>
                  }
                </span>
                <small class="rf-when">{{ minute(s.sec) }} min</small>
                <small class="rf-label">{{ s.label }}</small>
              </button>
            }
          </div>
        } @else {
          <p class="muted">The recorder kept no frames of this game.</p>
        }

        @if (current(); as shot) {
          <!-- role="dialog" without aria-modal (11 Sep 2026): this is an inline
               detail panel in the row's flow, nothing outside it is inert, and
               Tab walks straight out of it into the review panel. Claiming
               aria-modal told a screen reader the opposite. -->
          <div class="rf-light" #light tabindex="-1" role="dialog" [attr.aria-label]="'Frame at ' + minute(shot.sec) + ' minutes: ' + shot.label">
            <div class="rf-light-frame">
              @if (picture(shot.docId); as big) {
                <img class="rf-light-img" [src]="src(big)" [alt]="shot.label" />
              } @else if (picture(shot.docId) === null) {
                <p class="muted rf-light-missing">That frame is not stored any more.</p>
              } @else {
                <p class="muted rf-light-missing"><span class="btn-spinner" aria-hidden="true"></span> Reading the frame…</p>
              }
            </div>
            <p class="rf-light-label"><b>{{ minute(shot.sec) }} min</b> {{ shot.label }}</p>
            <div class="rf-light-actions">
              <button type="button" class="view-btn" [disabled]="at() === 0" (click)="step(-1)">
                <span class="material-symbols-rounded" aria-hidden="true">chevron_left</span> Earlier
              </button>
              <button type="button" class="view-btn" [disabled]="at() === last()" (click)="step(1)">
                Later <span class="material-symbols-rounded" aria-hidden="true">chevron_right</span>
              </button>
              <button type="button" class="view-btn rf-light-close" (click)="close()">
                <span class="material-symbols-rounded" aria-hidden="true">close</span> Close
              </button>
            </div>
          </div>
        }
      </div>
    }
  `
})
export class ReplayFramesComponent {
  private readonly recordings = inject(ReplayRecordingService);

  /** The replay's own id, the dashed form a replay row carries. */
  readonly matchId = input<string | undefined>(undefined);

  /**
   * Whether the row's drawer is open. Nothing is read while it is shut: a
   * game row keeps its drawer in the DOM whether it is folded or not, so an
   * eager read here would be one Firestore read per row on the list.
   */
  readonly open = input(false);

  /** Which frame the lightbox is showing, by index into the recording's shots. */
  protected readonly at = signal<number | null>(null);

  /** The pictures a read has been started for, so a thumbnail can show it is coming. */
  protected readonly asked = signal<ReadonlySet<string>>(new Set());

  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');
  private readonly light = viewChild<ElementRef<HTMLElement>>('light');

  /** Pictures read without being asked for, and whether the reader has touched the strip yet. Plain fields: nothing on screen reads them. */
  private eager = 0;
  private stirred = false;
  private readonly waiting = new Set<string>();

  protected readonly recording = computed<ReplayRecording | null>(() => this.recordings.recordingFor(this.matchId()) ?? null);
  /**
   * The frames, guarded the way both api readers guard them (11 Sep 2026).
   * The service casts the Firestore snapshot straight through, so a
   * half-written or hand-edited document with no `shots` used to take the
   * whole Games row down with a TypeError rather than drawing nothing.
   */
  protected readonly shots = computed<ReplayShotRef[]>(() => this.recording()?.shots ?? []);
  protected readonly last = computed(() => Math.max(0, this.shots().length - 1));
  protected readonly current = computed<ReplayShotRef | null>(() => {
    const i = this.at();
    return i === null ? null : (this.shots()[i] ?? null);
  });

  constructor() {
    // The drawer opened: read the recording, once, for everything on the row.
    effect(() => {
      const id = this.matchId();
      if (!this.open() || !id) return;
      if (this.recordings.known().has(id)) return;
      void this.recordings.load(id);
    });

    // A thumbnail on screen is one the reader is looking at, so its picture is
    // worth a read; the rest wait for a tap. On a wide drawer, though, eight
    // or nine thumbnails are on screen the moment a row opens, and each is a
    // few hundred kilobytes — so until the reader touches the strip only
    // EAGER_SHOTS load by themselves (11 Sep 2026), and after that every
    // thumbnail that comes into view does. No margin and a real threshold:
    // "in view" means in view, not two screens away.
    // Without an IntersectionObserver (jsdom, an old browser) nothing loads
    // by itself and every thumbnail still loads on tap.
    afterRenderEffect((onCleanup) => {
      const el = this.strip()?.nativeElement;
      const shots = this.shots();
      if (!el || !shots.length || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const id = (e.target as HTMLElement).dataset['doc'];
            if (!id) continue;
            io.unobserve(e.target);
            // Over the eager count and nobody has touched the strip yet: the
            // thumbnail is remembered, not read, and the first touch reads it.
            if (!this.stirred && this.eager >= EAGER_SHOTS) {
              this.waiting.add(id);
              continue;
            }
            this.eager += 1;
            untracked(() => this.fetch(id));
          }
        },
        { root: el, threshold: 0.6 }
      );
      for (const child of Array.from(el.querySelectorAll<HTMLElement>('.rf-shot'))) io.observe(child);
      onCleanup(() => io.disconnect());
    });

    // The lightbox takes the focus when it opens, so Escape and the arrows reach it.
    afterRenderEffect(() => {
      const el = this.light()?.nativeElement;
      if (el && this.at() !== null) untracked(() => el.focus({ preventScroll: true }));
    });
  }

  /** The picture for a shot: the document once read, `null` when it is gone, `undefined` while nobody has asked. */
  protected picture(docId: string): ReplayShot | null | undefined {
    return this.recordings.shotFor(docId);
  }

  protected src(shot: ReplayShot): string {
    return shotSrc(shot);
  }

  protected minute(sec: number): number {
    return Math.max(0, Math.floor(sec / 60));
  }

  protected recordedOn(rec: ReplayRecording): string {
    const when = Date.parse(rec.recordedAt);
    return Number.isNaN(when) ? 'an unknown day' : new Date(when).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  protected openAt(i: number): void {
    this.at.set(i);
    const shot = this.shots()[i];
    if (shot) this.fetch(shot.docId);
  }

  protected step(by: number): void {
    const i = this.at();
    if (i === null) return;
    const next = Math.min(this.last(), Math.max(0, i + by));
    if (next !== i) this.openAt(next);
  }

  protected close(): void {
    const i = this.at();
    this.at.set(null);
    // Back to the thumbnail it was opened from, so the keyboard does not land at the top of the row.
    if (i !== null) this.strip()?.nativeElement.querySelectorAll<HTMLElement>('.rf-shot')[i]?.focus({ preventScroll: true });
  }

  /** Escape closes the lightbox and the arrows step it; the row's own drawer keeps every other key. */
  protected onKey(ev: KeyboardEvent): void {
    if (this.at() === null) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.close();
      return;
    }
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      ev.preventDefault();
      ev.stopPropagation();
      this.step(ev.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  /**
   * The reader has engaged with the strip — scrolled, pointed at it or tabbed
   * into it — so the thumbnails that were on screen but over the eager count
   * are worth reading now, and everything that comes into view after this is
   * read as it arrives.
   */
  protected touched(): void {
    if (this.stirred) return;
    this.stirred = true;
    for (const id of this.waiting) this.fetch(id);
    this.waiting.clear();
  }

  /** One read a picture, marked as asked so the thumbnail can say it is coming. */
  private fetch(docId: string): void {
    if (this.recordings.shotFor(docId) !== undefined || this.asked().has(docId)) return;
    this.asked.update((set) => new Set(set).add(docId));
    void this.recordings.loadShot(docId);
  }
}
