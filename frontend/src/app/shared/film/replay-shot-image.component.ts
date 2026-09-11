import { Component, computed, effect, inject, input, untracked } from '@angular/core';
import { ReplayShot } from '../../models/team.models';
import { ReplayRecordingService, shotSrc } from '../../services/replay-recording.service';

/**
 * One picture the local recorder took of our own game, read when something on
 * screen genuinely wants it (12 Sep 2026).
 *
 * A frame is a document of its own — `replayShots/{matchId}__{sec}`, a few
 * hundred kilobytes of base64 — so the only question worth asking here is
 * when to spend the read. `wanted` is the host's answer: a chapter nobody has
 * walked to wants nothing, and opening a film must not cost a Firestore read
 * per frame of a game the reader never looks at. Once a picture has been
 * asked for, the id is remembered and never asked again; the service caches
 * for the session and de-dupes what is in flight, and this keeps the second
 * ask from reaching it at all.
 *
 * It draws the three states the service already tells apart and invents no
 * fourth: the picture itself, a document that is no longer there, and the
 * wait before either lands.
 *
 * It is deliberately **not** `shared/replay-frames.component.ts`. That one
 * answers "browse twenty moments in a drawer", which is why it carries an
 * eager count and an IntersectionObserver; this one answers "study one
 * moment". A shared abstraction over the two would have to carry both sets
 * of machinery and would fit neither question.
 */
@Component({
  selector: 'app-replay-shot',
  host: { class: 'replay-shot' },
  template: `
    @if (shot(); as picture) {
      <img class="replay-shot-img" [src]="src(picture)" [alt]="alt()" />
    } @else if (shot() === null) {
      <p class="muted replay-shot-note">That frame is not stored any more.</p>
    } @else if (wanted()) {
      <p class="muted replay-shot-note"><span class="btn-spinner" aria-hidden="true"></span> Reading the frame…</p>
    } @else {
      <p class="muted replay-shot-note"><span class="material-symbols-rounded" aria-hidden="true">photo_camera</span> The frame is read once this chapter comes up.</p>
    }
  `
})
export class ReplayShotImageComponent {
  private readonly recordings = inject(ReplayRecordingService);

  /** The `replayShots` document id the recording's own shot carries: the moment's `{matchId}__{sec}`, or a run-up frame's. */
  readonly docId = input.required<string>();
  /** What the picture is of, in the recorder's words; the host knows the moment and this component does not. */
  readonly alt = input<string>('');
  /** Whether this picture is worth a read yet. False keeps the read unspent and says so rather than spinning at nothing. */
  readonly wanted = input(true);

  /** The ids this host has already asked for. A plain field: nothing on screen reads it, so nothing should wake on it. */
  private readonly asked = new Set<string>();

  /** The picture once read, `null` when the document is gone, `undefined` while nobody has asked. */
  protected readonly shot = computed<ReplayShot | null | undefined>(() => this.recordings.shotFor(this.docId()));

  constructor() {
    effect(() => {
      const id = this.docId();
      if (!id || !this.wanted()) return;
      // The read starts outside the effect's own tracking: asking the service what
      // it already holds would make this effect a dependant of every picture in
      // the session, and it would then wake for frames that are nothing to do
      // with this one.
      untracked(() => this.ask(id));
    });
  }

  protected src(shot: ReplayShot): string {
    return shotSrc(shot);
  }

  /** One read an id, ever: a document already read, already absent, or already asked for is not asked for again. */
  private ask(id: string): void {
    if (this.asked.has(id) || this.recordings.shotFor(id) !== undefined) return;
    this.asked.add(id);
    void this.recordings.loadShot(id);
  }
}
