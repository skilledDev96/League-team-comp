import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, HostListener, inject, input, output, signal, untracked } from '@angular/core';
import { FilmGlyph, FilmModel, FilmStripMoment, FilmStripRow } from '../../../core/film-model';
import { Role } from '../../../models/team.models';
import { UiService } from '../../../services/ui.service';
import { FilmGlyphComponent } from '../../../shared/film/film-glyph.component';
import { ReplayShotImageComponent } from '../../../shared/film/replay-shot-image.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';

/** The glyph a moment wears on the rail, by the kind the recorder filed it under; anything it invents later falls back to the film's flag. */
const STRIP_GLYPHS: Record<string, FilmGlyph> = { death: 'skull', objective: 'flag', end: 'check' };

/** One frame of the moment on stage: the document to read, how far before the moment it is, and the words for both. */
export interface StripFrame {
  docId: string;
  /** Seconds before the moment; 0 is the moment itself. */
  before: number;
  /** The step's face: "-8s", "-6s", "now". */
  step: string;
  /** The step's tip, which is where the figure's terms are said in full. */
  tip: string;
  /** The picture's own words, for a reader who cannot see it. */
  alt: string;
}

/**
 * How far before the moment one of its frames is, read off the document id's
 * own suffix (`{matchId}__{sec}__{frame}`) and never counted off the index.
 *
 * The index was the answer only while the run-up was one frame a second. Since
 * 12 Sep 2026 it is spread across `SHOT_LEAD_SEC` (8) seconds, so five ids
 * counted by index read "-4s -3s -2s -1s now" over pictures genuinely eight,
 * six, four and two seconds before — and `--frames` moves the spacing again, so
 * no figure derived from the count can be right for every strip. The recorder
 * writes the true one into the id; this reads it back. A moment's own picture
 * has no suffix and is 0, which is what "now" means.
 */
function secondsBefore(docId: string): number {
  const parts = String(docId ?? '').split('__');
  const said = parts.length >= 3 ? Number(parts[parts.length - 1]) : 0;
  return Number.isFinite(said) && said > 0 ? Math.round(said) : 0;
}

/** "Down, 8s to respawn" — the seconds the client had left on somebody already on the floor, with their terms. */
export function downLine(row: FilmStripRow): string {
  const left = typeof row.respawn === 'number' && row.respawn > 0 ? Math.round(row.respawn) : 0;
  return left ? `Down, ${left}s to respawn` : 'Down';
}

/**
 * The frames (12 Sep 2026): the first chapter of the film built from the
 * local recorder rather than from Riot.
 *
 * A custom game has no match and no timeline, so what we know of it is what
 * the recorder saw walking the replay in the League client: a picture at each
 * moment that mattered — since recorder version 3 the eight seconds leading
 * in, one frame every two, as well as the moment itself — and, at every death
 * of ours, what all ten were holding as we fell. The film has never shown
 * either. This chapter is where it does, and it is laid out like the map so
 * that it reads as part of the same film: the picture large on the left with a
 * five-step control under it, the board of ten beside it, and a rail of the
 * moments under both.
 *
 * **What it costs is the design.** A recording can carry twenty moments and
 * sixty frames, and each frame is a document of a few hundred kilobytes, so
 * nothing at all is read while the chapter is off stage; when it comes up,
 * the moment's own frames are read and the *next* moment's picture with them,
 * so stepping forward is instant and stepping back is free. Everything else
 * waits to be walked to. `ReplayRecordingService` keeps what it reads for the
 * session and de-dupes what is in flight, so a moment walked back to costs
 * nothing a second time.
 *
 * Their side is a champion in a seat, here as everywhere: a board row of
 * theirs carries a seat and a champion and nothing else, because nothing else
 * of theirs is stored.
 */
@Component({
  selector: 'app-film-strip',
  imports: [NgTemplateOutlet, TooltipDirective, FilmFrameComponent, FilmGlyphComponent, ReplayShotImageComponent],
  template: `
    @let strip = model().strip;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (strip) {
        @if (moment(); as m) {
          <div class="film-strip">
            <div class="film-strip-stage">
              <p class="film-strip-label"><span class="film-strip-clock">{{ m.clock }}</span><span class="film-strip-words">{{ m.label }}</span></p>

              @if (!strip.pictures) {
                <!-- The run kept everything but the pixels: a panel that prints a Riot id would not confirm itself off, so the recorder stopped the pictures and wrote the rest. -->
                <p class="film-wait film-strip-none">The recorder kept no frames of this game, so there is nothing to look at — only the boards and the lines beside them.</p>
              } @else if (!frames().length) {
                <p class="film-wait film-strip-none">No picture was kept of this moment; the board beside it is what the recorder read at it.</p>
              } @else {
                <!-- Every frame of this moment stands in the tree at once, and the step shows one: they are read together, so stepping is a change of class and never a wait. -->
                <div class="film-strip-shots">
                  @for (f of frames(); track f.docId) {
                    <app-replay-shot class="film-strip-shot" [class.is-shown]="$index === frame()" [docId]="f.docId" [alt]="f.alt" [wanted]="active()" />
                  }
                </div>
                @if (frames().length > 1) {
                  <div class="film-strip-steps" role="group" aria-label="How long before the moment">
                    <span class="film-strip-steps-label">Seconds before</span>
                    @for (f of frames(); track f.docId) {
                      <button type="button" class="view-btn" [class.active]="$index === frame()" [attr.aria-pressed]="$index === frame()" [appTip]="f.tip" (click)="frame.set($index)">{{ f.step }}</button>
                    }
                  </div>
                } @else {
                  <p class="film-strip-steps-one muted">This recording kept one picture a moment.</p>
                }
              }
              <!-- The next moment's own picture, read with this one so walking forward lands on it: off screen, and never a second read of what the session already holds. -->
              @if (warm(); as ahead) {
                <app-replay-shot class="film-strip-warm" [docId]="ahead" [wanted]="active()" aria-hidden="true" />
              }
            </div>

            <div class="film-strip-side">
              <p class="film-strip-opening">{{ strip.opening }}</p>
              @if (recordedOn(); as day) { <p class="film-strip-when muted">Recorded on {{ day }}.</p> }

              @if (!strip.boards) {
                <p class="film-wait film-strip-none">This game was recorded before the boards were kept, so what the ten were holding is only what the picture shows.</p>
              } @else if (m.board; as board) {
                <ol class="list-clean film-strip-board" aria-label="What all ten were holding">
                  @for (r of board; track r.ours + ':' + r.seat) {
                    <li class="film-strip-row" [class.is-ours]="r.ours" [class.is-victim]="!!r.victim" [class.is-down]="!!r.dead" [class.is-pickable]="pickable(r)" [style.--i]="$index">
                      <!--
                        One of ours whose deaths the run kept is a button: it leaves the rail showing
                        that seat alone, which is the question a board actually prompts — "show me
                        every time this player fell". The same seat filter the tape and the map wear.
                        Theirs is never a button, and not for want of styling: the recorder files a
                        moment at a death of OURS, so there is nothing of theirs to filter to.
                      -->
                      @if (pickable(r)) {
                        <button
                          type="button"
                          class="film-strip-rowbtn"
                          [class.active]="seat() === r.seat"
                          [attr.aria-pressed]="seat() === r.seat"
                          [appTip]="seat() === r.seat ? 'Show every moment again' : 'Show only this seat\\'s moments'"
                          (click)="toggleSeat(r.seat)"
                        >
                          <ng-container *ngTemplateOutlet="rowBody; context: { $implicit: r }" />
                        </button>
                      } @else {
                        <ng-container *ngTemplateOutlet="rowBody; context: { $implicit: r }" />
                      }
                    </li>
                  }
                </ol>
              } @else {
                <p class="film-wait film-strip-none">The recorder reads the board at a death of ours, and this moment is not one.</p>
              }

              @if (m.line) { <p class="film-strip-line">{{ m.line }}</p> }
              <p class="film-strip-caveat muted">{{ strip.caveat }}</p>
            </div>

            @if (seat(); as only) {
              <p class="film-strip-filter">
                Showing our {{ only }} alone — {{ shown().length }} of {{ moments().length }} moments.
                <button type="button" class="view-btn" (click)="toggleSeat(only)">Show all</button>
              </p>
            }
            <ol class="list-clean film-strip-rail" aria-label="The moments the recorder kept">
              @for (x of shown(); track x.moment.key) {
                <li [style.--i]="$index">
                  <button
                    type="button"
                    class="film-strip-chip"
                    [class.is-current]="x.index === cursor()"
                    [attr.aria-current]="x.index === cursor() ? 'true' : null"
                    [appTip]="x.moment.label"
                    (click)="pick(x.index)"
                  >
                    <app-film-glyph [name]="glyph(x.moment)" />
                    <span class="film-strip-chip-clock">{{ x.moment.clock }}</span>
                  </button>
                </li>
              }
            </ol>
          </div>
        } @else {
          <p class="film-wait">The recorder kept no moments of this game.</p>
        }
      } @else {
        <p class="film-wait">No recording for this game, so there are no frames.</p>
      }
    </app-film-frame>

    <!--
      One row of the board, written once and rendered either inside a button or on its own. Written
      once on purpose: a copy per branch is how the two drift, and the row of ours and the row of
      theirs have to stay identical in everything but whether they can be pressed.
    -->
    <ng-template #rowBody let-r>
      @if (r.champion) {
        <img class="film-strip-face" [src]="ui.championIconUrl(r.champion)" alt="" loading="lazy" />
      } @else {
        <span class="film-strip-face is-blank" aria-hidden="true"></span>
      }
      <span class="film-strip-who">
        <b>{{ who(r) }}</b>
        <small>{{ r.seat }}{{ r.champion ? ' · ' + ui.championName(r.champion) : '' }}</small>
      </span>
      <span class="film-strip-figs">
        <b>{{ r.level }}</b><small>level</small>
        <b>{{ r.cs }}</b><small>CS</small>
      </span>
      @if (r.victim) { <span class="film-strip-fell">Fell here</span> }
      @if (r.dead) { <span class="film-strip-down">{{ down(r) }}</span> }
      <span class="film-strip-items">
        @for (item of r.items; track $index) {
          <span class="film-strip-item">{{ item }}</span>
        } @empty {
          <span class="film-strip-item is-none">Nothing</span>
        }
      </span>
    </ng-template>
  `
})
export class FilmStripComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The frames');
  readonly index = input<number>(1);
  readonly count = input<number>(1);
  /** True while this is the chapter on stage. Nothing is read while it is false: that is the whole read policy. */
  readonly active = input<boolean>(false);
  /** Bumped by the page on Escape: a strip stepped off its moment goes back to it. */
  readonly closeTick = input<number>(0);
  /** Said only when that Escape actually put something back, so the page's leave-in-two rule arms on a press that found nothing to close. */
  readonly escaped = output<void>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly ui = inject(UiService);

  /** Which moment the chapter is on, and which of its frames. Both per visit; a film is walked, not resumed. */
  protected readonly cursor = signal(0);
  protected readonly frame = signal(0);

  protected readonly moments = computed<FilmStripMoment[]>(() => this.model().strip?.moments ?? []);
  protected readonly moment = computed<FilmStripMoment | undefined>(() => this.moments()[this.cursor()]);

  /**
   * The seat the rail is showing alone, set by pressing one of ours on the board. Per visit, like
   * the cursor: a film is walked, not resumed.
   */
  protected readonly seat = signal<Role | null>(null);

  /** Which of our seats the run actually kept a moment for; the rest are not worth offering. */
  private readonly seatsKept = computed(() => new Set(this.moments().map((m) => m.seat).filter((s): s is Role => !!s)));

  /**
   * The rail's moments, each with its index in the UNFILTERED list.
   *
   * The index travels with the moment because `cursor` indexes the whole list and always has: a
   * filtered rail that renumbered would put the reader on a different death than the one they
   * pressed the moment a filter changed.
   */
  protected readonly shown = computed<{ moment: FilmStripMoment; index: number }[]>(() => {
    const only = this.seat();
    return this.moments()
      .map((moment, index) => ({ moment, index }))
      .filter((x) => !only || x.moment.seat === only);
  });

  /**
   * The moment's frames, earliest first and the moment last, which is the
   * order the recorder wrote them in and the order they are read in: the
   * run-up leading in, then what it looked like as it happened.
   */
  protected readonly frames = computed<StripFrame[]>(() => {
    const ids = this.moment()?.frames ?? [];
    const label = this.moment()?.label ?? 'this moment';
    return ids.map((docId) => {
      const before = secondsBefore(docId);
      return {
        docId,
        before,
        step: before ? `-${before}s` : 'now',
        tip: before ? `The frame ${before} second${before === 1 ? '' : 's'} before the moment` : 'The moment itself',
        alt: before ? `${label}, ${before} second${before === 1 ? '' : 's'} before` : label
      };
    });
  });

  /**
   * The one picture read ahead of the reader: the next moment's own frame,
   * never its run-up. Walking forward is the common move and this makes it
   * instant, while a whole moment ahead would triple what an unwalked chapter
   * costs.
   */
  protected readonly warm = computed<string | null>(() => {
    const ahead = this.moments()[this.cursor() + 1]?.frames ?? [];
    return ahead.length ? ahead[ahead.length - 1] : null;
  });

  /** The day the run was made, in the same short form the frames drawer on a Games row prints. */
  protected readonly recordedOn = computed<string>(() => {
    const when = Date.parse(this.model().strip?.recordedOn ?? '');
    return Number.isNaN(when) ? '' : new Date(when).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  });

  /** The game on the strip; a string, so the walk restarts for another game and never for a rebuilt model of this one. */
  private readonly matchId = computed(() => this.model().matchId);

  /** The last Escape this chapter has answered, so the effect's own first run is not read as a press. */
  private lastTick = 0;

  constructor() {
    // A new moment opens on the moment itself. The run-up is there to be
    // stepped back into, and nobody walking the film asked to land two
    // seconds early.
    effect(() => {
      this.cursor();
      const n = this.frames().length;
      untracked(() => this.frame.set(Math.max(0, n - 1)));
    });

    // A new game in the same component (the title card links film to film and the page is reused): the walk starts over.
    effect(() => {
      this.matchId();
      untracked(() => this.cursor.set(0));
    });

    // The page's Escape. The one thing this chapter can have open is a step
    // off the moment, so that is what a press puts back; a press that found
    // the strip already on its moment is not ours, and saying nothing is what
    // lets the second one leave the film. The tick is compared rather than
    // merely read, because an effect runs once on its own when the chapter is
    // built, and that first run is not a press.
    effect(() => {
      const tick = this.closeTick();
      untracked(() => {
        if (tick === this.lastTick) return;
        this.lastTick = tick;
        const last = Math.max(0, this.frames().length - 1);
        if (this.frame() === last) return;
        this.frame.set(last);
        this.escaped.emit();
      });
    });
  }

  /** A moment on the rail. Out of range is ignored rather than clamped: the rail only ever offers what is there. */
  protected pick(i: number): void {
    if (i < 0 || i >= this.moments().length) return;
    this.cursor.set(i);
  }

  protected glyph(moment: FilmStripMoment): FilmGlyph {
    return STRIP_GLYPHS[moment.kind] ?? 'flag';
  }

  /**
   * Can this row of the board be pressed? Only one of ours, and only a seat the run kept a moment
   * for. A button that filters to nothing is worse than no button: it reads as a broken control
   * rather than as an empty answer.
   */
  protected pickable(row: FilmStripRow): boolean {
    return !!row.ours && !!row.seat && this.seatsKept().has(row.seat);
  }

  /**
   * Show one seat's moments, or all of them again.
   *
   * When the moment on stage is not in the seat being shown, the rail jumps to that seat's first —
   * otherwise the picture and the rail disagree, with the current chip nowhere on screen.
   */
  protected toggleSeat(seat: Role): void {
    const next = this.seat() === seat ? null : seat;
    this.seat.set(next);
    if (!next) return;
    if (this.moment()?.seat === next) return;
    const first = this.shown()[0];
    if (first) {
      this.cursor.set(first.index);
      this.frame.set(0);
    }
  }

  /** Ours by name where the recording carries one; theirs is a seat, because no name of theirs is stored anywhere. */
  protected who(row: FilmStripRow): string {
    return row.name || `${row.ours ? 'Our' : 'Their'} ${row.seat}`;
  }

  protected down(row: FilmStripRow): string {
    return downLine(row);
  }

  /**
   * The arrows step the frames of the moment on stage, and with Shift they
   * step the moments, which is the tape's grammar for the same two sizes of
   * move. Only while this chapter is up, and never out of a field somebody is
   * typing in.
   */
  @HostListener('window:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (!this.active()) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    const dir = event.key === 'ArrowRight' ? 1 : -1;
    event.preventDefault();
    if (event.shiftKey) this.pick(this.cursor() + dir);
    else this.frame.set(Math.min(Math.max(this.frame() + dir, 0), Math.max(0, this.frames().length - 1)));
  }
}
