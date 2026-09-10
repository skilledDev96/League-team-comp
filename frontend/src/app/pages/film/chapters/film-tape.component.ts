import { Location } from '@angular/common';
import { afterRenderEffect, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { READ_LABELS } from '../../../core/death-reads';
import { placeAt, railGroups, wardsAt } from '../../../core/film-build';
import { createFilmClock, FilmClock } from '../../../core/film-clock';
import { FilmBeat, FilmDeathPin, FilmFrame, FilmModel, FilmSeat, FilmWard } from '../../../core/film-model';
import { FilmTapeSpeedKey, TAPE_SPEED_STORAGE_KEY, TAPE_SPEEDS, tapeSpeedFor, voiceOf } from '../../../core/film-style';
import { FilmLabDrawing, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { MotionService } from '../../../services/motion.service';
import { TeamDataService } from '../../../services/team-data.service';
import { ToastService } from '../../../services/toast.service';
import { UiService } from '../../../services/ui.service';
import { FilmGlyphComponent } from '../../../shared/film/film-glyph.component';
import { clockText, FilmScrubberComponent } from '../../../shared/film/film-scrubber.component';
import { PositionLabComponent } from '../../../shared/film/position-lab.component';
import { RiftMapComponent, RiftToken } from '../../../shared/film/rift-map.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';

/** How long the curve takes to draw when the chapter comes up, before the tempo. */
const DRAW_MS = 1200;
/** A guess this close to the answer counts as called; the scrubber uses the same number. */
const CLOSE_MINUTES = 2;
/** A beat's card holds the tape for at least this long, at most that, and otherwise as long as its words take to read at 280 ms each; then the tempo. */
const DWELL_MIN_MS = 3500;
const DWELL_MAX_MS = 8000;
const DWELL_PER_WORD_MS = 280;
/** The hand within this many seconds of a beat lights its chip on the rail. */
const BEAT_NEAR_SEC = 30;
/** The words on the tape's speed group, said once as a tip: what a thirty-minute game takes at each step. */
const SPEED_TIP = 'A thirty-minute game runs 3 min, 90 s, 45 s or 22 s';
/** The lab shows the deaths of ours this close to its second either way (Part C, 10 Sep 2026): the one it was opened on, and what fell just before or after it. */
export const LAB_DEATH_WINDOW_SEC = 60;
/** The lab's note key on the film: "lab:<sec>". */
export const LAB_NOTE_PREFIX = 'lab:';

/** A request from the page to move the hand: `n` makes a second request to the same second distinct. */
export interface FilmSeekRequest {
  sec: number;
  n: number;
  /** Play on from there; the page asks for it off the map's Watch it. */
  play?: boolean;
  /** Open the position lab on that second once the hand stands there (Part C, 10 Sep 2026); the page asks for it off the map's Work on this second. Never with `play`. */
  lab?: boolean;
}

/** What the lab stands on once opened: the second, the frame blended to it, the frame a minute before for their pace, the wards live then, and the deaths of ours around it. */
export interface FilmLabScene {
  sec: number;
  frame: FilmFrame;
  previous: FilmFrame | null;
  wards: FilmWard[];
  deaths: FilmDeathPin[];
}

/**
 * The scene for the lab at a second, off the tape's frames (Part C, 10 Sep
 * 2026): `placeAt` blends the ten to the second, the frame a minute before
 * (blended too, so their pace reads over a whole minute; none in the first
 * minute, where the lab falls back to its floor), `wardsAt` the wards live
 * then, and the map's pins within LAB_DEATH_WINDOW_SEC either way. Null
 * without frames: an older timeline has no lab.
 */
export function labSceneAt(frames: readonly FilmFrame[] | undefined, wards: readonly FilmWard[] | undefined, pins: readonly FilmDeathPin[], sec: number): FilmLabScene | null {
  const frame = placeAt(frames, sec);
  if (!frame) return null;
  const previous = sec >= 60 ? placeAt(frames, sec - 60) : null;
  return {
    sec,
    frame,
    previous,
    wards: wardsAt(wards, sec),
    deaths: pins.filter((p) => Math.abs(p.sec - sec) <= LAB_DEATH_WINDOW_SEC).sort((a, b) => a.sec - b.sec)
  };
}

/** One of our five as a tile over the map: the seat, the champion and the name, from the film's seats. */
export interface FilmSeatTile {
  seat: Role;
  champion: string;
  name?: string;
}

/** A minute on the rail: `railGroups`' shape, named so the template and the spec can say it. */
export type RailGroup = ReturnType<typeof railGroups>[number];

/** Why the hand is standing still with something in the sheet. */
type TapeStop = { kind: 'beat'; sec: number; beat: FilmBeat } | { kind: 'token'; sec: number; label: string; line?: string };

/** The beat after (`dir` 1) or before (`dir` -1) a second; undefined when there is none that way. A beat on the very second the hand stands on is "here", never the next one. */
export function neighbourBeat(beats: readonly FilmBeat[], sec: number, dir: 1 | -1): FilmBeat | undefined {
  const sorted = [...beats].sort((a, b) => a.sec - b.sec);
  return dir > 0 ? sorted.find((b) => b.sec > sec + 0.5) : [...sorted].reverse().find((b) => b.sec < sec - 0.5);
}

/** How long a beat's card stays before the tape plays on, before the tempo. */
export function dwellMsFor(text: string): number {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, words * DWELL_PER_WORD_MS));
}

/**
 * A beat Deaths only keeps (10 Sep 2026): a death of ours, or a fight, an
 * objective or a coach's moment that a death of ours was folded into. The
 * lead asked for the timeline broken down on the deaths; a death inside a
 * fight is still a death, so the fight stands on the rail with it.
 */
export function isDeathBeat(b: FilmBeat): boolean {
  return b.kind === 'death' || (b.deaths?.length ?? 0) > 0;
}

/**
 * Whether a beat is about one seat (10 Sep 2026, the per-champion view): the
 * beat names the seat, or one of the deaths folded into it was that seat's
 * (`seatOf` looks a pin key up). A beat about nobody in particular, the turn
 * or a first blood, is skipped under a seat's view: the lead asked for the
 * clutter gone, and those two are on the curve and the map still.
 */
export function beatIsAbout(b: FilmBeat, seat: Role, seatOf: (pinKey: string) => Role | undefined): boolean {
  if (b.seats?.includes(seat)) return true;
  return (b.deaths ?? []).some((key) => seatOf(key) === seat);
}

/** The speed step the viewer last picked, from storage; null where storage is out of reach (a private window, a server). */
export function storedSpeedKey(): string | null {
  try {
    return localStorage.getItem(TAPE_SPEED_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The tape (9 Sep 2026; cut 4 on 10 Sep 2026): the Rift with the game
 * dropping onto it second by second, over the scrubber whose track is the
 * gold curve. The tape narrates now instead of asking: the curve stands as
 * soon as the chapter has a clock and draws itself to the turn once when the
 * chapter comes up, the sheet opens on where it turned (with the reader's
 * takeover guess under it when they made one), and the hand stops on each
 * beat the build picked out (the coach's moments, the objectives, the
 * fights, the firsts, the turn and every death of ours) with a card
 * that says what it was, whose it was, who it was about and what the gold
 * did next. A beat holds for a dwell measured off its words, shown as a bar
 * running down, then the tape plays on by itself; Pause holds the card,
 * the voice's Continue skips the dwell. A rail of the beats under the sheet
 * jumps to any of them without playing. Tapping a token pauses on its label,
 * and a death of ours brings the film's read of it. Copy link carries the
 * second. Only the chapter on stage runs its clock. With motion off nothing
 * plays on its own: the curve stands whole, the scrubber is a native range
 * and Prev and Next beat pills do the walking.
 *
 * Later on 10 Sep 2026 the lead watched it and asked for four things, all
 * here: the speed is the viewer's (`TAPE_SPEEDS`, remembered in storage,
 * the film's own stock only picks where it opens); five tiles over the sheet
 * show one seat at a time (the Rift hides the others through `seatFilter`,
 * and the tape stops only on the beats about that seat, the rail dimming
 * the chips it will skip); the rail is one chip a minute (`railGroups`),
 * with a count when the minute holds more than one and a Deaths only pill
 * that keeps the deaths' minutes alone; and Full screen gives the Rift the
 * stage, the sheet and the rail moving into a drawer with a close pill
 * (the page's Escape, through `closeTick`, closes the drawer first and the
 * full screen next; neither is stored, a visit starts small).
 *
 * Part C (10 Sep 2026; the lead: "we want to see where our vision was
 * placed", "a visualisation tool from a certain point in this timeline map
 * to see where we could have been better positioned"). On a version 3
 * timeline the tape carries frames and wards, and the Rift grows two layers
 * behind two pills in the tools row: Everyone (on by default; the ten
 * moving between the minutes) and Vision (off; our wards with their sight,
 * each where the placer stood). Work on this second opens the position lab
 * (`app-position-lab`) over the frame on the hand's second, the Rift
 * paused: the ten where the blended frame put them, the frame a minute
 * before for their pace, the wards live then and the deaths around it; a
 * death beat's card offers the same pill at the death's second, and the
 * map's Work on this second arrives as a seek request with `lab`. Save
 * writes the drawing as a film note keyed "lab:<sec>" with the lab's
 * reading line as its text (editors only; a viewer gets the lab without
 * Save), Close or Escape returns to the tape (Escape closes the lab before
 * the drawer or the full screen). An older timeline shows none of it.
 */
@Component({
  selector: 'app-film-tape',
  imports: [TooltipDirective, FilmFrameComponent, RiftMapComponent, FilmScrubberComponent, FilmGlyphComponent, PositionLabComponent],
  template: `
    @let tape = model().tape;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (tape) {
        <div class="film-tape" [class.is-revealed]="revealed()" [class.is-full]="full()" [class.is-drawer-closed]="full() && !drawer()">
          <div class="film-tape-map">
            <app-rift-map [events]="tape.events" [until]="t()" [highlightSeats]="litSeats()" [highlightSec]="litSec()" [seatFilter]="seatFilter()" [frames]="tape.frames" [showEveryone]="showEveryone()" [wards]="tape.wards" [showVision]="showVision()" (tap)="onTap($event)" />
            @if (full() && !drawer()) {
              <button type="button" class="view-btn film-full-open" appTip="Bring the sheet and the rail back" (click)="openDrawer()"><span class="material-symbols-rounded" aria-hidden="true">dock_to_right</span> Sheet</button>
            }
          </div>

          <div class="film-tape-side">
            @if (full()) {
              <button type="button" class="view-btn film-full-close" appTip="Close the drawer; the Rift stays full screen" (click)="closeDrawer()"><span class="material-symbols-rounded" aria-hidden="true">close</span> Close</button>
            }
            <!-- One seat at a time (10 Sep 2026): the Rift keeps that seat's deaths and backs, its lane's plates and the landmarks; the tape stops on its beats alone. All resets.
                 The tiles stand over the sheet, not over the Rift as the plan first had them (Fix pass, 10 Sep 2026): in the map column their 3.4rem came
                 out of the square, and with the scrubber's real 9.45rem the tape overflowed its frame at 1920x1080; here they cost the square nothing and
                 sit where the map chapter keeps its own. -->
            <div class="film-seat-tiles" role="group" aria-label="One seat at a time">
              <button type="button" class="film-seat-tile is-all" [class.active]="seatFilter() === 'all'" [attr.aria-pressed]="seatFilter() === 'all'" appTip="Every seat on the map, every beat on the tape" (click)="pickSeat('all')">
                <span class="film-seat-tile-all"><span class="material-symbols-rounded" aria-hidden="true">groups</span></span>
                <small>All</small>
              </button>
              @for (s of seatTiles(); track s.seat) {
                <button type="button" class="film-seat-tile" [style.--i]="$index + 1" [class.active]="seatFilter() === s.seat" [attr.aria-pressed]="seatFilter() === s.seat" [appTip]="tileTip(s)" (click)="pickSeat(s.seat)">
                  <img [src]="ui.championIconUrl(s.champion)" [alt]="s.champion" loading="lazy" />
                  <small>{{ s.seat }}</small>
                </button>
              }
            </div>
            <aside class="film-tape-sheet" aria-live="polite">
              @if (stop(); as s) {
                @switch (s.kind) {
                  @case ('beat') {
                    <article class="film-beat" [attr.data-kind]="s.beat.kind">
                      <span class="film-beat-glyph" [class.is-ok]="s.beat.swing === 'us'" [class.is-warn]="s.beat.swing === 'them'"><app-film-glyph [name]="s.beat.glyph" [size]="1.6" /></span>
                      <p class="film-tape-sheet-kicker film-beat-kicker" [class.is-ok]="s.beat.swing === 'us'" [class.is-warn]="s.beat.swing === 'them'">
                        <span class="film-tape-min">{{ clockAt(s.beat.sec) }}</span> {{ swingWord(s.beat) }}
                      </p>
                      <!-- A coach's moment is titled by its swing, which the kicker has just said; the title line stands only when it adds a word. -->
                      @if (s.beat.title !== swingWord(s.beat)) { <p class="film-beat-title">{{ s.beat.title }}</p> }
                      <p class="film-tape-sheet-text film-beat-text">{{ s.beat.text }}</p>
                      @if (tiles(s.beat).length) {
                        <div class="film-beat-tiles" aria-label="Who it was about">
                          @for (tile of tiles(s.beat); track tile.champion) {
                            <span class="film-beat-tile" [style.--i]="$index" [appTip]="tile.seat ? tile.seat + ' · ' + tile.champion : tile.champion">
                              <img [src]="ui.championIconUrl(tile.champion)" [alt]="tile.champion" loading="lazy" />
                              @if (tile.seat) { <small>{{ tile.seat }}</small> }
                            </span>
                          }
                        </div>
                      }
                      <!-- The deaths folded into a fight, an objective or a moment (10 Sep 2026): each as a tile with its read, the read's line as the tip, so a fight still says who fell in it and how the film reads each. -->
                      @if (deathsOf(s.beat).length) {
                        <ul class="list-clean film-beat-deaths" aria-label="Who fell in it">
                          @for (p of deathsOf(s.beat); track p.key) {
                            <li class="film-beat-death" [style.--i]="$index" [appTip]="p.readLine">
                              @if (p.champion) { <img [src]="ui.championIconUrl(p.champion)" [alt]="p.champion" loading="lazy" /> }
                              <span class="film-beat-death-who">{{ p.name || p.seat }} <span class="film-tape-min">{{ clockAt(p.sec) }}</span></span>
                              <span [class]="'film-read-badge is-read-' + p.read"><app-film-glyph [name]="readLabels[p.read].icon" />{{ readLabels[p.read].label }}</span>
                            </li>
                          }
                        </ul>
                      }
                      @if (s.beat.consequence) { <p class="film-tape-sheet-line film-beat-consequence">{{ s.beat.consequence }}</p> }
                      @if (dwell(); as d) {
                        <span #dwellBar class="film-beat-dwell" [style.--dwell]="d.ms + 'ms'" role="progressbar" aria-label="Playing on shortly" [attr.aria-valuetext]="'Plays on in about ' + Math.round(d.ms / 1000) + ' seconds'"></span>
                      }
                      <div class="film-beat-actions">
                        @if (dwell()) {
                          <button type="button" class="view-btn active" (click)="hold()"><span class="material-symbols-rounded" aria-hidden="true">pause</span> Pause</button>
                          <button type="button" class="view-btn" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">skip_next</span> {{ voice().momentContinue }}</button>
                        } @else if (held()) {
                          <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> Play on</button>
                        } @else {
                          <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> {{ voice().momentContinue }}</button>
                        }
                        <!-- A death's card (Part C, 10 Sep 2026): the lab on the death's second, where the frames carry one; a fight or a moment a death was folded into counts, and opens on the folded death's own second (labSecOf). Where a board was saved on that second the pill opens the board. -->
                        @if (hasFrames() && isDeathBeat(s.beat)) {
                          <button type="button" class="view-btn film-lab-btn" [appTip]="labPillTip(labSecOf(s.beat))" (click)="openLab(labSecOf(s.beat))"><span class="material-symbols-rounded" aria-hidden="true">draw</span> {{ labPillWord(labSecOf(s.beat)) }}</button>
                        }
                      </div>
                    </article>
                  }
                  @case ('token') {
                    <p class="film-tape-sheet-kicker"><span class="film-tape-min">{{ clockAt(s.sec) }}</span></p>
                    <p class="film-tape-sheet-text">{{ s.label }}</p>
                    @if (s.line) { <p class="film-tape-sheet-line">{{ s.line }}</p> }
                    <button type="button" class="view-btn active" (click)="resume()"><span class="material-symbols-rounded" aria-hidden="true">play_arrow</span> {{ voice().momentContinue }}</button>
                  }
                }
              } @else {
                <p class="film-tape-sheet-kicker" [class.is-ok]="close()">{{ close() ? 'Called it' : 'Where it turned' }}</p>
                @if (tape.turn; as turn) {
                  <p class="film-tape-sheet-text">{{ turn.why }}</p>
                } @else {
                  <p class="film-tape-sheet-text">The curve never settled on one turning point; the review reads the moments instead.</p>
                }
                <!-- The takeover's guess against the turn is said once, under the scrubber's track, where the two markers stand; the sheet only wears "Called it". -->
                @if (!motion.reduced()) {
                  <p class="film-tape-sheet-hint">Space plays, arrows step a minute, Shift with an arrow jumps to a beat.</p>
                }
              }

              @if (motion.reduced()) {
                <div class="film-tape-steps">
                  <button type="button" class="view-btn" [disabled]="!prevBeat()" (click)="jump(-1)"><span class="material-symbols-rounded" aria-hidden="true">skip_previous</span> Previous beat</button>
                  <button type="button" class="view-btn" [disabled]="!nextBeat()" (click)="jump(1)">Next beat <span class="material-symbols-rounded" aria-hidden="true">skip_next</span></button>
                </div>
              }
            </aside>

            @if (tape.beats.length) {
              <!-- The rail (10 Sep 2026): one chip a minute with the first beat's glyph and a count when the minute holds more; a tap opens the first and Continue walks the rest. A chip the tape will skip under a seat's view is dimmed. -->
              <div class="film-rail">
                <ol class="list-clean film-beats" aria-label="The beats of this game, by minute">
                  @for (g of rail(); track g.minute) {
                    <li>
                      <button type="button" class="film-beat-chip" [class.is-current]="isCurrent(g)" [class.is-skipped]="isSkipped(g)" [class.has-board]="hasBoard(g)" [class.is-ok]="g.beats[0].swing === 'us'" [class.is-warn]="g.beats[0].swing === 'them'" [attr.aria-current]="isCurrent(g) ? 'true' : null" [attr.aria-label]="groupLabel(g)" [appTip]="groupTip(g)" (click)="showGroup(g)">
                        <app-film-glyph [name]="g.beats[0].glyph" />
                        <span>{{ g.minute }}</span>
                        @if (g.beats.length > 1) { <small class="film-beat-count">{{ g.beats.length }}</small> }
                      </button>
                    </li>
                  }
                </ol>
                <button type="button" class="view-btn film-deaths-only" [class.active]="deathsOnly()" [attr.aria-pressed]="deathsOnly()" appTip="Only the deaths on the rail, and the tape stops on those alone" (click)="toggleDeathsOnly()"><app-film-glyph name="skull" /> Deaths only</button>
              </div>
            }
          </div>

          <div class="film-tape-scrub">
            <app-film-scrubber
              [durationSec]="tape.durationSec"
              [goldDiff]="tape.goldDiff"
              [t]="shownT()"
              [moments]="tape.moments"
              [revealed]="revealed()"
              [guess]="guessShown()"
              [answer]="tape.turn?.minute ?? null"
              [playing]="playing()"
              [ask]="voice().turnQuestion"
              [lockLabel]="voice().lockPill"
              (seek)="seek($event)"
              (toggle)="toggle()"
            />
            <div class="film-tape-tools">
              <!-- The speed (10 Sep 2026, the lead: "make the timeline slower or adjustable"): four steps, the pick takes at once and is remembered per browser; the film's stock only says where it opens. -->
              <div class="film-speed" role="group" aria-label="Tape speed" [appTip]="speedTip">
                @for (s of speeds; track s.key) {
                  <button type="button" class="view-btn" [class.active]="speed().key === s.key" [attr.aria-pressed]="speed().key === s.key" (click)="pickSpeed(s.key)">{{ s.label }}</button>
                }
              </div>
              @if (hasFrames()) {
                <!-- The layers (Part C, 10 Sep 2026): Everyone on by default, Vision off, both per visit. A timeline before version 3 carries neither, so the pills stay away rather than promise a layer the document cannot draw. -->
                <span class="film-layers" role="group" aria-label="Layers on the Rift">
                  <button type="button" class="view-btn film-layer-btn" [class.active]="showEveryone()" [attr.aria-pressed]="showEveryone()" appTip="Everyone on the Rift, moving between the minutes; approximate, positions once a minute" (click)="toggleEveryone()"><span class="material-symbols-rounded" aria-hidden="true">groups</span> Everyone</button>
                  <button type="button" class="view-btn film-layer-btn" [class.active]="showVision()" [attr.aria-pressed]="showVision()" appTip="Our wards and their sight, each where the placer stood at the nearest minute; approximate" (click)="toggleVision()"><app-film-glyph name="ward" /> Vision</button>
                </span>
              }
              <span class="film-tape-tools-end">
                @if (hasFrames()) {
                  <button type="button" class="view-btn film-lab-btn" [appTip]="labPillTip(t())" (click)="openLab()"><span class="material-symbols-rounded" aria-hidden="true">draw</span> {{ labPillWord(t()) }}</button>
                }
                <button type="button" class="view-btn film-full-btn" [class.active]="full()" [attr.aria-pressed]="full()" [appTip]="full() ? 'Back to the tape beside its sheet' : 'The Rift takes the stage; the sheet and the rail move into a drawer'" (click)="toggleFull()">
                  <span class="material-symbols-rounded" aria-hidden="true">{{ full() ? 'fullscreen_exit' : 'fullscreen' }}</span> {{ full() ? 'Exit full screen' : 'Full screen' }}
                </button>
                <button type="button" class="view-btn" [appTip]="'Copy a link to this second of the tape'" (click)="copyLink()"><span class="material-symbols-rounded" aria-hidden="true">link</span> Copy link</button>
              </span>
            </div>
          </div>
        </div>
        <!-- The position lab over the frame (Part C, 10 Sep 2026): the Rift under it stands paused on the second; Close or Escape returns to the tape, a save keeps the lab open on the board as saved (10 Sep 2026, second fix pass), and a board the film already keeps on the second comes back through the saved input. -->
        @if (labScene(); as l) {
          <dialog class="film-lab-overlay" #labDialog [attr.aria-label]="'Work on ' + clockAt(l.sec)" (cancel)="onLabCancel($event)">
            <app-position-lab
              [sec]="l.sec"
              [ourSide]="tape.ourSide"
              [frame]="l.frame"
              [previous]="l.previous"
              [wards]="l.wards"
              [deaths]="l.deaths"
              [ours]="model().seats"
              [matchId]="model().matchId"
              [canSave]="auth.canEdit()"
              [saved]="labSaved()"
              (save)="saveLab($event)"
              (close)="closeLab()"
            />
          </dialog>
        }
      } @else {
        <p class="film-wait">No timeline read for this game, so there is no tape.</p>
      }
    </app-film-frame>
  `
})
export class FilmTapeComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The tape');
  readonly index = input<number>(1);
  readonly count = input<number>(1);
  /** True while this is the chapter on screen: the clock runs only then. */
  readonly active = input<boolean>(false);
  /** The minute the reader said it turned in the takeover, from their progress (calls['turn']); undefined when they never did. */
  readonly guess = input<number | undefined>(undefined);
  /** The second the link opened on (?t=), seeked to once when the clock is made. */
  readonly initialSec = input<number | null>(null);
  /** The page asks for a second, off the map's Watch it. */
  readonly seekTo = input<FilmSeekRequest | null>(null);
  /** Bumped by the page on Escape (10 Sep 2026): in full screen the drawer closes first, the full screen next; nothing otherwise. */
  readonly closeTick = input<number>(0);
  /** A `closeTick` that closed something (the drawer, the full screen), so the page does not count that press towards leaving the film (10 Sep 2026, second fix pass). */
  readonly escaped = output<void>();
  /** Copy link was pressed: the second copied, so the page can put it in the url. */
  readonly copied = output<number>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly motion = inject(MotionService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly data = inject(TeamDataService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dwellBar = viewChild<ElementRef<HTMLElement>>('dwellBar');
  /** The lab while it is open, for its reading line on Save. */
  private readonly labView = viewChild(PositionLabComponent);
  /**
   * The lab is a real `<dialog>` opened with `showModal` (10 Sep 2026, the
   * evening): as a plain layer it lived inside the chapter's own stacking
   * context, so the tape's speed and layer pills stayed on top of it and the
   * screen read as two sets of controls at once. The top layer sits above
   * every stacking context and every transform, which no z-index can promise.
   */
  private readonly labDialog = viewChild<ElementRef<HTMLDialogElement>>('labDialog');

  protected readonly Math = Math;
  protected readonly readLabels = READ_LABELS;
  protected readonly speeds = TAPE_SPEEDS;
  protected readonly speedTip = SPEED_TIP;
  protected readonly isDeathBeat = isDeathBeat;
  private readonly clock = signal<FilmClock | null>(null);
  protected readonly t = computed(() => this.clock()?.t() ?? 0);
  protected readonly playing = computed(() => this.clock()?.playing() ?? false);
  protected readonly guessShown = computed<number | null>(() => this.guess() ?? null);
  /** The curve is never hidden on the tape (cut 4): it stands as soon as the chapter has a clock. */
  protected readonly revealed = computed(() => this.clock() !== null);
  /** The curve's draw when the chapter comes up: the second drawn to so far, or null once it is drawn and the clock's own second stands. */
  private readonly drawT = signal<number | null>(null);
  protected readonly shownT = computed(() => this.drawT() ?? this.t());
  protected readonly stop = signal<TapeStop | null>(null);
  /** The dwell running on the beat card: the key of the beat and how long, after the tempo; null when nothing is counting down. */
  protected readonly dwell = signal<{ key: string; ms: number } | null>(null);
  /** Pause was pressed during a dwell: the card holds until Play on. */
  protected readonly held = signal(false);
  /** One seat of ours at a time, or every seat: the Rift's view and the beats the tape stops on. Per visit. */
  protected readonly seatFilter = signal<Role | 'all'>('all');
  /** The rail shows the deaths' minutes alone and the tape stops on those alone. Per visit. */
  protected readonly deathsOnly = signal(false);
  /** The step the viewer picked, as stored; anything the steps do not name falls back to the film's own (`tapeSpeedFor`). */
  private readonly speedKey = signal<string | null>(storedSpeedKey());
  protected readonly speed = computed(() => tapeSpeedFor(this.speedKey(), this.model().style));
  /** Full screen: the Rift takes the stage and the side column is a drawer; `drawer` is whether that drawer is open. Both per visit, never stored. */
  protected readonly full = signal(false);
  protected readonly drawer = signal(true);
  /** The layers on the Rift (Part C, 10 Sep 2026): everyone on the map, on by default; our vision, off by default. Per visit. */
  protected readonly showEveryone = signal(true);
  protected readonly showVision = signal(false);
  /** The second the position lab is open on; null while it is closed. Per visit. */
  protected readonly lab = signal<number | null>(null);
  private dwellTimer: ReturnType<typeof setTimeout> | undefined;
  private lastT = -1;
  private drawn = false;
  private drawFrame: number | null = null;
  private seekHandled = 0;
  /** The page's Escape counter as last seen; null before the chapter's first look at it, which is its creation and never a press. */
  private closeSeen: number | null = null;
  /** Watch it asked for play while the chapter was still off stage: play once it is on. */
  private playWhenActive = false;
  /**
   * The beats already narrated at the second the hand stands on (10 Sep 2026,
   * second review): two beats in one second (grubs and a dragon in one
   * minute, a first tower and an objective) are stopped on one after the
   * other, since the hand cannot cross a second it is standing on. Cleared
   * whenever the hand is moved elsewhere.
   */
  private shownAt: { sec: number; keys: Set<string> } | null = null;
  /**
   * The rest of a minute opened from the rail (10 Sep 2026): a chip with
   * several beats opens the first, and Continue walks these before the tape
   * plays on. Any move of the hand drops them.
   */
  private queue: FilmBeat[] = [];

  /** What the clock is keyed on: the game and its length. A rebuilt model (another review landing) keeps the clock and its second. */
  private readonly clockKey = computed(() => {
    const m = this.model();
    return m.tape ? `${m.matchId}:${m.tape.durationSec}` : null;
  });

  protected readonly close = computed(() => {
    const g = this.guessShown();
    const a = this.model().tape?.turn?.minute ?? null;
    return g !== null && a !== null && Math.abs(g - a) <= CLOSE_MINUTES;
  });
  /** The chrome's strings for this film: the pill after a beat, and the scrubber's words. Never the coach's text. */
  protected readonly voice = computed(() => voiceOf(this.model().style));
  /** The seats a beat is about: the map rings their tokens around that second while the hand stands there. */
  protected readonly litSeats = computed<readonly Role[]>(() => {
    const s = this.stop();
    return s?.kind === 'beat' ? (s.beat.seats ?? []) : [];
  });
  /** The beat's second, so only the seat's tokens near it light, not every death and back since minute 0. */
  protected readonly litSec = computed<number | null>(() => {
    const s = this.stop();
    return s?.kind === 'beat' ? s.beat.sec : null;
  });
  /** Our five as tiles, in lane order, from the film's seats; a seat the review did not fill has no tile. */
  protected readonly seatTiles = computed<FilmSeatTile[]>(() => {
    const seats = this.model().seats;
    return ROLES.map((r) => seats.find((s) => s.seat === r))
      .filter((s): s is FilmSeat => !!s)
      .map((s) => ({ seat: s.seat, champion: s.champion, name: s.name }));
  });
  /** The map's pins by key, for the deaths a beat folded and the seat a folded death belongs to. */
  private readonly pinsByKey = computed(() => new Map((this.model().map?.pins ?? []).map((p) => [p.key, p])));
  /** Whether the timeline kept the positions (version 3): the layer pills and the lab exist only then. */
  protected readonly hasFrames = computed(() => (this.model().tape?.frames?.length ?? 0) > 0);
  /** What the lab stands on, read off the model so a rebuilt model (another review landing) keeps the lab whole; null while it is closed or without frames. */
  protected readonly labScene = computed<FilmLabScene | null>(() => {
    const sec = this.lab();
    const tape = this.model().tape;
    if (sec === null || !tape) return null;
    return labSceneAt(tape.frames, tape.wards, this.model().map?.pins ?? [], sec);
  });
  /** The boards the film keeps, by second (10 Sep 2026, second fix pass): every note keyed "lab:<sec>" that carries a drawing. Read off the live notes, so a save shows at once. */
  private readonly boards = computed<Map<number, FilmLabDrawing>>(() => {
    const out = new Map<number, FilmLabDrawing>();
    for (const [key, note] of Object.entries(this.data.notesFor(this.model().matchId)?.notes ?? {})) {
      if (!key.startsWith(LAB_NOTE_PREFIX) || !note.lab) continue;
      const sec = Number(key.slice(LAB_NOTE_PREFIX.length));
      if (Number.isFinite(sec)) out.set(sec, note.lab);
    }
    return out;
  });
  /** The board kept on the lab's second, for the lab to open on; null without one or while the lab is closed. */
  protected readonly labSaved = computed<FilmLabDrawing | null>(() => {
    const sec = this.lab();
    return sec === null ? null : (this.boards().get(sec) ?? null);
  });
  /**
   * The beats the hand stops on: every beat, cut to the deaths under Deaths
   * only and to one seat's under a seat's view. Prev, Next, Shift with an
   * arrow and the play itself all read this list; the rail reads the wider
   * one and dims what is not in here.
   */
  protected readonly stopBeats = computed<FilmBeat[]>(() => {
    const beats = this.model().tape?.beats ?? [];
    const deathsOnly = this.deathsOnly();
    const seat = this.seatFilter();
    const seatOf = (key: string) => this.pinsByKey().get(key)?.seat;
    return beats.filter((b) => (!deathsOnly || isDeathBeat(b)) && (seat === 'all' || beatIsAbout(b, seat, seatOf)));
  });
  private readonly stopKeys = computed(() => new Set(this.stopBeats().map((b) => b.key)));
  /** The rail's minutes: every beat, or the deaths' alone under Deaths only; a seat's view dims rather than hides, so the reader still sees the game's shape. */
  protected readonly rail = computed<RailGroup[]>(() => {
    const beats = this.model().tape?.beats ?? [];
    return railGroups(this.deathsOnly() ? beats.filter(isDeathBeat) : beats);
  });
  protected readonly prevBeat = computed(() => neighbourBeat(this.stopBeats(), this.t(), -1));
  protected readonly nextBeat = computed(() => neighbourBeat(this.stopBeats(), this.t(), 1));

  constructor() {
    // One clock per game, keyed on the match and its length, never on the model's identity; the link's second is the first thing it shows.
    effect((onCleanup) => {
      const key = this.clockKey();
      if (!key) return;
      const durationSec = Number(key.slice(key.lastIndexOf(':') + 1));
      // The rate is the viewer's pick, else the step the film's own stock leans to (10 Sep 2026); a pick while the clock runs goes through setRate, so this never remakes it.
      const secPerGameMinute = untracked(() => this.speed().secPerGameMinute);
      const clock = createFilmClock({ durationSec, secPerGameMinute });
      untracked(() => {
        // A new game in the same component (the title card links film to film and the page is reused): nothing of the
        // last tape's card, dwell, draw, pending Watch it, seat view or full screen carries over (10 Sep 2026, second review).
        this.cancelDraw();
        this.cancelDwell();
        this.stop.set(null);
        this.shownAt = null;
        this.queue = [];
        this.drawn = false;
        this.playWhenActive = false;
        this.seatFilter.set('all');
        this.deathsOnly.set(false);
        this.full.set(false);
        this.drawer.set(true);
        this.showEveryone.set(true);
        this.showVision.set(false);
        this.lab.set(null);
        const init = this.initialSec();
        if (init !== null && Number.isFinite(init)) clock.seek(init);
        this.lastT = clock.t();
        this.clock.set(clock);
      });
      onCleanup(() => clock.destroy());
    });

    // Only the chapter on stage runs; a Watch it that arrived off stage plays once it is on. Leaving the chapter drops any dwell with the clock.
    effect(() => {
      const active = this.active();
      untracked(() => {
        const clock = this.clock();
        if (!active) {
          this.cancelDwell();
          clock?.pause();
          return;
        }
        if (this.playWhenActive && clock) {
          this.playWhenActive = false;
          if (!this.motion.reduced()) clock.play();
        }
      });
    });

    // The curve draws itself to the hand once, the first time the chapter is up with a clock.
    effect(() => {
      const clock = this.clock();
      if (!clock || !this.active() || this.drawn) return;
      this.drawn = true;
      untracked(() => this.draw(clock));
    });

    // The hand lands on a beat it has just crossed and holds there for its dwell.
    effect(() => {
      const t = this.t();
      const clock = this.clock();
      untracked(() => {
        if (!clock) return;
        const prev = this.lastT;
        this.lastT = t;
        if (!clock.playing() || t <= prev) return;
        const beat = this.nextBeatBetween(prev, t);
        if (!beat) return;
        clock.pause();
        clock.seek(beat.sec);
        this.lastT = beat.sec;
        this.markShown(beat);
        this.show({ kind: 'beat', sec: beat.sec, beat });
        this.startDwell(beat);
      });
    });

    // The lab's dialog goes into the top layer as soon as it is on the page, and comes out with it. A browser without
    // `showModal` (jsdom in the specs) leaves the element where it stands, which the specs read the same way.
    afterRenderEffect((onCleanup) => {
      const dialog = this.labDialog()?.nativeElement;
      if (!dialog) return;
      untracked(() => {
        if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      });
      onCleanup(() => {
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
      });
    });

    // The dwell bar runs down over the dwell through the one door to the Web Animations API, so its length is the same measured number the timer uses; it dies with the bar.
    afterRenderEffect((onCleanup) => {
      const el = this.dwellBar()?.nativeElement;
      const d = this.dwell();
      if (!el || !d) return;
      untracked(() => void this.motion.play(el, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: d.ms, easing: 'linear', fill: 'forwards' }));
      onCleanup(() => {
        try {
          el.getAnimations().forEach((a) => a.cancel());
        } catch {
          /* no Web Animations: the bar simply stood at its last frame */
        }
      });
    });

    // The page asks for a second: the map's Watch it, twenty seconds before the death; or its Work on this second, which opens the lab there.
    effect(() => {
      const req = this.seekTo();
      const clock = this.clock();
      if (!req || !clock || req.n === this.seekHandled) return;
      this.seekHandled = req.n;
      untracked(() => {
        // Watch it is this chapter's first showing when it arrives before the chapter has been up: the hand stands twenty
        // seconds before the death and plays, and the curve is not swept from 0:00 under a clock already running (10 Sep 2026).
        this.drawn = true;
        this.seek(req.sec);
        if (req.lab) {
          this.openLab(req.sec);
          return;
        }
        if (!req.play || this.motion.reduced()) return;
        // The page is still fading the map out when this lands: only the chapter on stage plays.
        if (this.active()) clock.play();
        else this.playWhenActive = true;
      });
    });

    // Escape from the page (10 Sep 2026): in full screen the drawer folds first, the full screen on the next press. Each press that
    // closes something says so through `escaped`, so the page's second-press rule (two Escapes within two seconds go Back) only arms
    // on a press that found nothing to close: Escape, Escape out of full screen used to drop the reader on Games (second fix pass).
    effect(() => {
      const tick = this.closeTick();
      untracked(() => {
        // The first run is the chapter's creation, not a press (Part C, 10 Sep 2026): the page's counter may already stand at
        // three from earlier presses on the map, and a lab the seek request has just opened must not be closed by it.
        if (this.closeSeen === tick) return;
        const first = this.closeSeen === null;
        this.closeSeen = tick;
        if (first) return;
        // The lab first (Part C, 10 Sep 2026): it stands over everything else, so it is what an Escape means while it is open.
        if (this.lab() !== null) {
          this.closeLab();
          this.escaped.emit();
          return;
        }
        if (!this.full()) return;
        if (this.drawer()) this.drawer.set(false);
        else this.full.set(false);
        this.escaped.emit();
      });
    });

    this.destroyRef.onDestroy(() => {
      this.cancelDraw();
      this.cancelDwell();
    });
  }

  /** Where the hand stands when the chapter comes up: the link's second when there is one, else the turning point, else the end so the whole curve shows; then the curve draws to it and the tape plays on. */
  private draw(clock: FilmClock): void {
    const tape = this.model().tape;
    if (!tape) return;
    if (this.initialSec() === null && clock.t() === 0) {
      clock.seek(tape.turn ? tape.turn.minute * 60 : tape.durationSec);
      this.lastT = clock.t();
    }
    const target = clock.t();
    if (this.motion.reduced() || target <= 0 || typeof requestAnimationFrame !== 'function') return;
    const ms = DRAW_MS * this.motion.tempo(this.host.nativeElement);
    const start = performance.now();
    this.drawT.set(0);
    const step = (now: number) => {
      const f = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - f, 3);
      if (f < 1) {
        this.drawT.set(target * eased);
        this.drawFrame = requestAnimationFrame(step);
      } else {
        this.drawFrame = null;
        this.drawT.set(null);
        if (this.active() && clock.t() < clock.durationSec) clock.play();
      }
    };
    this.drawFrame = requestAnimationFrame(step);
  }

  private cancelDraw(): void {
    if (this.drawFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.drawFrame);
    this.drawFrame = null;
    this.drawT.set(null);
  }

  /** The earliest stop the hand crossed between two seconds, or one still unsaid on the very second it set off from. */
  private nextBeatBetween(prev: number, t: number): FilmBeat | undefined {
    const here = this.shownAt;
    return this.stopBeats()
      .filter((b) => b.sec <= t && (b.sec > prev || (here !== null && here.sec === b.sec && !here.keys.has(b.key))))
      .sort((a, b) => a.sec - b.sec)[0];
  }

  /** The card stood on this beat at its second; a sibling in the same second is still owed. */
  private markShown(beat: FilmBeat): void {
    if (this.shownAt?.sec !== beat.sec) this.shownAt = { sec: beat.sec, keys: new Set() };
    this.shownAt.keys.add(beat.key);
  }

  /** Something lands in the sheet: in full screen with the drawer closed, the drawer comes back for it, since the card is what the stop is for (10 Sep 2026). */
  private show(stop: TapeStop): void {
    this.stop.set(stop);
    if (this.full() && !this.drawer()) this.drawer.set(true);
  }

  /** The beat's card holds for its dwell, then the tape plays on; never with motion off, where nothing plays on its own. */
  private startDwell(beat: FilmBeat): void {
    this.cancelDwell();
    if (this.motion.reduced()) return;
    const ms = dwellMsFor(beat.text) * this.motion.tempo(this.host.nativeElement);
    this.dwell.set({ key: beat.key, ms });
    this.dwellTimer = setTimeout(() => {
      this.dwell.set(null);
      // The reader may have moved on meanwhile; only a card still standing on this beat plays on.
      const s = this.stop();
      if (s?.kind === 'beat' && s.beat.key === beat.key) this.resume();
    }, ms);
  }

  /** Every path that moves the hand or the card clears the dwell: a seek, a toggle, a token tap, a rail tap, leaving the chapter, destroy. */
  private cancelDwell(): void {
    clearTimeout(this.dwellTimer);
    this.dwellTimer = undefined;
    this.dwell.set(null);
    this.held.set(false);
  }

  protected seek(sec: number): void {
    const clock = this.clock();
    if (!clock) return;
    this.cancelDraw();
    this.cancelDwell();
    clock.seek(sec);
    this.lastT = clock.t();
    this.shownAt = null;
    this.queue = [];
    this.stop.set(null);
  }

  protected toggle(): void {
    const clock = this.clock();
    if (!clock) return;
    this.cancelDwell();
    this.queue = [];
    if (clock.playing()) {
      clock.pause();
      return;
    }
    this.stop.set(null);
    clock.play();
  }

  /** Pause during a dwell: the card holds until Play on. */
  protected hold(): void {
    clearTimeout(this.dwellTimer);
    this.dwellTimer = undefined;
    this.dwell.set(null);
    this.held.set(true);
  }

  /** Continue after a stop: the next beat of a minute opened from the rail when one is owed, else the hand moves on from where it stands. */
  protected resume(): void {
    const [owed, ...rest] = this.queue;
    if (owed) {
      this.showBeat(owed);
      this.queue = rest;
      return;
    }
    this.cancelDwell();
    this.stop.set(null);
    if (!this.motion.reduced()) this.clock()?.play();
  }

  /** A beat from the rail, or Shift with an arrow: the hand lands on it and the card reads it, without playing. */
  protected showBeat(b: FilmBeat): void {
    const clock = this.clock();
    if (!clock) return;
    clock.pause();
    this.seek(b.sec);
    this.markShown(b);
    this.show({ kind: 'beat', sec: b.sec, beat: b });
  }

  /**
   * A minute from the rail: its first beat opens and Continue walks the rest
   * (10 Sep 2026). Under a seat's view the walk keeps to the beats about that
   * seat when the minute has any, and takes the whole minute when it has
   * none, since the reader asked for it by tapping a dimmed chip.
   */
  protected showGroup(g: RailGroup): void {
    const kept = g.beats.filter((b) => this.stopKeys().has(b.key));
    const walk = kept.length ? kept : g.beats;
    this.showBeat(walk[0]);
    this.queue = walk.slice(1);
  }

  /** Prev or Next beat with motion off. */
  protected jump(dir: 1 | -1): void {
    const b = dir > 0 ? this.nextBeat() : this.prevBeat();
    if (b) this.showBeat(b);
  }

  /** A token tapped: the hand pauses on its label, and a death of ours brings the film's read of it. */
  protected onTap(tok: RiftToken): void {
    this.cancelDwell();
    this.queue = [];
    this.clock()?.pause();
    const pin = tok.pinKey ? this.pinsByKey().get(tok.pinKey) : undefined;
    const line = pin?.readLine || pin?.line;
    this.show({ kind: 'token', sec: tok.sec, label: tok.label, line: line || undefined });
  }

  /** One seat's view, or All: the Rift and the stops follow at once; the card standing stays. */
  protected pickSeat(seat: Role | 'all'): void {
    this.seatFilter.set(seat);
  }

  protected toggleDeathsOnly(): void {
    this.deathsOnly.set(!this.deathsOnly());
  }

  /** The viewer's speed: the clock takes it at once, keeping its second, and the browser remembers it for the next film. */
  protected pickSpeed(key: FilmTapeSpeedKey): void {
    this.speedKey.set(key);
    this.clock()?.setRate(this.speed().secPerGameMinute);
    try {
      localStorage.setItem(TAPE_SPEED_STORAGE_KEY, key);
    } catch {
      /* no storage (a private window): the pick lasts this visit */
    }
  }

  /** Full screen on, with the drawer open; or off. Per visit. */
  protected toggleFull(): void {
    this.full.set(!this.full());
    this.drawer.set(true);
  }

  protected closeDrawer(): void {
    this.drawer.set(false);
  }

  protected openDrawer(): void {
    this.drawer.set(true);
  }

  protected toggleEveryone(): void {
    this.showEveryone.set(!this.showEveryone());
  }

  protected toggleVision(): void {
    this.showVision.set(!this.showVision());
  }

  /**
   * Work on this second (Part C, 10 Sep 2026): the lab opens on the hand's
   * second, or the one asked for (a death beat's, the map's), with the Rift
   * paused under it and whatever card was dwelling let go, since the lab is
   * the thing to read now. Nothing without frames: an older timeline has no
   * positions to stand the ten on.
   */
  protected openLab(sec = this.t()): void {
    const tape = this.model().tape;
    if (!tape?.frames?.length) return;
    this.cancelDwell();
    this.queue = [];
    this.clock()?.pause();
    this.lab.set(Math.min(Math.max(0, Math.round(sec)), tape.durationSec));
  }

  /** Close or Escape: the tape is back, still standing on the second, paused until the reader plays on. A save does not close the lab (10 Sep 2026, second fix pass). */
  protected closeLab(): void {
    const dialog = this.labDialog()?.nativeElement;
    // Closing the element takes it out of the top layer; the @if then drops it. A dialog that never opened (no showModal in a spec's jsdom) is left alone.
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    this.lab.set(null);
  }

  /** Escape inside the dialog: the browser would close the element and leave the chapter's state behind, so the close goes through `closeLab` instead. */
  protected onLabCancel(event: Event): void {
    event.preventDefault();
    this.closeLab();
  }

  /** Whether the film keeps a board on a second. */
  protected hasBoardAt(sec: number): boolean {
    return this.boards().has(Math.round(sec));
  }

  /** A minute on the rail carries a board when one was saved on a second inside it. */
  protected hasBoard(g: RailGroup): boolean {
    for (const sec of this.boards().keys()) if (Math.floor(sec / 60) === g.minute) return true;
    return false;
  }

  /**
   * The second the lab opens on from a card: a death's own, or the first
   * death folded into a fight, an objective or a moment (its pin's second,
   * up to 45 s from the host's; 10 Sep 2026, second fix pass), else the
   * beat's.
   */
  protected labSecOf(b: FilmBeat): number {
    if (b.kind === 'death') return b.sec;
    return this.deathsOf(b)[0]?.sec ?? b.sec;
  }

  /** The lab pill's words: the board where the film keeps one on the second, the lab otherwise. */
  protected labPillWord(sec: number): string {
    return this.hasBoardAt(sec) ? 'Open the board' : 'Work on this second';
  }

  protected labPillTip(sec: number): string {
    return this.hasBoardAt(sec)
      ? `Open the board saved on ${clockText(Math.round(sec))}: the drawing comes back, and Save keeps a change`
      : 'Open the position lab on this second: drag ours, try a ward, read the ground';
  }

  /**
   * Save from the lab: the drawing goes on the film's notes under
   * "lab:<sec>" with the lab's reading line as the note's text (the line
   * the coach would have said over the board), and the toast says so once
   * the write has landed. The lab stays open on the board as saved, so the
   * next Save is an edit (10 Sep 2026, second fix pass: two comments had
   * promised a return to the tape that nothing did, and the board is the
   * better place to stay). A board cleared to nothing takes the note off
   * the film. The lab only offers Save to an editor, so the write is theirs.
   */
  protected async saveLab(drawing: FilmLabDrawing): Promise<void> {
    const matchId = this.model().matchId;
    const key = `${LAB_NOTE_PREFIX}${drawing.sec}`;
    if (!drawing.moved.length && !drawing.wards.length && !drawing.arrows.length) {
      await this.data.saveFilmNote(matchId, key, '');
      this.toast.show("Board taken off the film's notes", { kind: 'ok', icon: 'draw', text: clockText(drawing.sec) });
      return;
    }
    const line = this.labView()?.readingLine().trim() || `A drawing from the position lab at ${clockText(drawing.sec)}`;
    await this.data.saveFilmNote(matchId, key, line, drawing);
    this.toast.show("Saved to the film's notes", { kind: 'ok', icon: 'draw', text: `${clockText(drawing.sec)} · ${line}` });
  }

  /** A minute's chip is lit while the card stands on one of its beats, or while the hand is within half a minute of one. */
  protected isCurrent(g: RailGroup): boolean {
    const s = this.stop();
    if (s?.kind === 'beat') return g.beats.some((b) => b.key === s.beat.key);
    const t = this.t();
    return g.beats.some((b) => Math.abs(t - b.sec) <= BEAT_NEAR_SEC);
  }

  /** A minute the tape will not stop on under the seat's view: none of its beats is about the seat. Deaths only never dims, it hides. */
  protected isSkipped(g: RailGroup): boolean {
    const keys = this.stopKeys();
    return !g.beats.some((b) => keys.has(b.key));
  }

  /** "Fight in the river, Nia falls, traded, 9:12" for the screen reader; the tip says the same without the clock. */
  protected groupLabel(g: RailGroup): string {
    return `${this.groupTip(g)}, ${clockText(g.beats[0].sec)}`;
  }

  protected groupTip(g: RailGroup): string {
    const tip = g.beats.map((b) => b.title).join(', ');
    return this.hasBoard(g) ? `${tip}, a board saved` : tip;
  }

  protected tileTip(s: FilmSeatTile): string {
    return s.name ? `${s.name} · ${s.seat} · ${s.champion}` : `${s.seat} · ${s.champion}`;
  }

  protected swingWord(b: FilmBeat): string {
    return b.swing === 'us' ? 'Our way' : b.swing === 'them' ? 'Their way' : 'Even';
  }

  /** The deaths folded into a beat, as the map's pins, in the beat's order; a key the map does not carry is skipped. */
  protected deathsOf(b: FilmBeat): FilmDeathPin[] {
    const pins = this.pinsByKey();
    return (b.deaths ?? []).map((key) => pins.get(key)).filter((p): p is FilmDeathPin => !!p);
  }

  /** The champions a beat is about, each with the seat the film knows them in; a champion the seats do not carry stands without one. One already listed among the beat's deaths is not shown twice. */
  protected tiles(b: FilmBeat): { champion: string; seat?: Role }[] {
    const seats = this.model().seats;
    const fallen = new Set(this.deathsOf(b).map((p) => p.champion));
    return (b.champions ?? [])
      .filter((champion) => !fallen.has(champion))
      .map((champion) => {
        const seat = seats.find((s) => s.champion === champion)?.seat;
        return seat ? { champion, seat } : { champion };
      });
  }

  @HostListener('window:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (!this.active() || !this.clock()) return;
    // The lab has the keys while it is open (Part C, 10 Sep 2026): a space over its square is not a play.
    if (this.lab() !== null) return;
    // A key pressed on the window itself (nothing focused) has no element to ask; the scrubber's track and any control handle their own keys.
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.closest('.film-scrub-track') || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName) || target.isContentEditable)) return;
    switch (event.key) {
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        this.toggle();
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir: 1 | -1 = event.key === 'ArrowRight' ? 1 : -1;
        event.preventDefault();
        if (event.shiftKey) {
          const b = neighbourBeat(this.stopBeats(), this.t(), dir);
          if (b) this.showBeat(b);
          else this.seek(dir > 0 ? this.clock()!.durationSec : 0);
        } else {
          this.seek(Math.round(this.t()) + 60 * dir);
        }
        return;
      }
    }
  }

  protected async copyLink(): Promise<void> {
    const sec = Math.round(this.t());
    const url = this.router.serializeUrl(this.router.createUrlTree(['/film', this.model().matchId], { queryParams: { c: 'tape', t: sec } }));
    const link = `${window.location.origin}${this.location.prepareExternalUrl(url)}`;
    try {
      await navigator.clipboard.writeText(link);
      this.toast.show('Link copied', { kind: 'ok', icon: 'link', text: `It opens the tape at ${clockText(sec)}.` });
      this.copied.emit(sec);
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: 'The browser refused the clipboard; copy the address bar instead.' });
    }
  }

  protected clockAt(sec: number): string {
    return clockText(sec);
  }
}
