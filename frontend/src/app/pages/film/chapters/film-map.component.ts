import { afterRenderEffect, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEATH_READS, DeathReadKind, READ_LABELS, readCounts } from '../../../core/death-reads';
import { PLACEMENT_NOTES, PlacementRead, placementOf } from '../../../core/film-build';
import { buildHeat } from '../../../core/film-heat';
import { COULD_GLYPHS, FilmDeathPin, FilmMap, FilmModel, FilmSeat } from '../../../core/film-model';
import { voiceOf } from '../../../core/film-style';
import { initialsOf } from '../../../core/initials';
import { COULD_LABELS, HOW_LABELS, ZONE_LABELS } from '../../../core/review-view';
import { DeathHow, FilmNote, MapZone, Role, ROLES } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { MotionService } from '../../../services/motion.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { DeathSceneComponent } from '../../../shared/film/death-scene.component';
import { countText } from '../../../shared/film/film-count';
import { FilmGlyphComponent } from '../../../shared/film/film-glyph.component';
import { MarkLegendComponent } from '../../../shared/film/mark-legend.component';
import { RiftMapComponent } from '../../../shared/film/rift-map.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent } from '../film-frame.component';
import { FilmSeatTile } from './film-tape.component';

/** A death's cost is said on the card only from this much gold either way; under it the two minutes after read as noise. */
const COST_SAYS_GOLD = 300;
/** The sentence the corner note carries as its tip (10 Sep 2026: it ran under the square until the Rift grew to the stage). */
export const APPROXIMATE_TIP = 'Positions are approximate: one frame a minute, placed inside the zone the frame put them in.';
/** The same sentence for a film built off a version 4 timeline, where a death carries the kill event's own position (11 Sep 2026). */
export const PLACED_TIP = 'Every death here stands where the game says it happened: the kill event carries its own position. The rest of the square is still read a minute at a time.';
/** And for a document that has positions for some deaths and not others: the ones without keep the old sample inside their zone. */
export const MIXED_TIP =
  'Most deaths here stand where the game says they happened, off the position the kill event carries; the few the timeline kept no position for are still placed inside their zone. Everything else is read a minute at a time.';
/** The tip that goes with each of the three notes, so the corner never says one thing and its tooltip another. */
export const PLACEMENT_TIPS: Record<PlacementRead, string> = { event: PLACED_TIP, mixed: MIXED_TIP, zone: APPROXIMATE_TIP };
/** The corner note while the vision heat shows (Part C, 10 Sep 2026): a ward event carries no position, so every ward's cell is where its placer stood at the nearest minute. */
export const HEAT_NOTE = 'where our wards stood, approximate';
export const HEAT_TIP = 'The wash is where our wards stood against where we died, over the whole game: a ward at the spot its placer stood at the nearest minute (a ward event carries no position of its own), heavier the longer it lived; a death as a patch where the zone put it.';

/** Thousands as "1.2k", under a thousand as the number; the same shape as the facts' own lines and the tape's consequences. */
export function k(gold: number): string {
  const abs = Math.abs(gold);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(abs);
}

/** A cost with its sign, for the costliest strip: "-1.2k", "+400". */
export function signedK(gold: number): string {
  return `${gold < 0 ? '-' : '+'}${k(gold)}`;
}

/** The line under a death's read on the card, when the two minutes after moved the gold enough to say so; empty otherwise. */
export function costLine(cost: number | undefined): string {
  if (typeof cost !== 'number' || Math.abs(cost) < COST_SAYS_GOLD) return '';
  return cost < 0 ? `It cost about ${k(cost)} over the next two minutes.` : `We came out ${k(cost)} up over the next two minutes.`;
}

/**
 * The map (9 Sep 2026; cut 4 on 10 Sep 2026): every death of ours on the
 * Rift where the timeline put it, theirs as dots and the fights as blobs,
 * and beside it the film's reading of each one. Nothing here asks any more:
 * the side opens on one line over the deaths (how many were avoidable,
 * traded, bought an objective, clean), a legend of the reads lights the pins
 * of one read at a time, a strip names the deaths that cost most, and the
 * card walks the deaths one at a time with the read's badge, a drawn scene
 * of what was around it (`app-death-scene`), the read in a sentence, what
 * it cost over the next two minutes, the ledger's own line when it says
 * more, and the tags as chips. A tap on a pin or a costliest card jumps to
 * it, Watch it takes the tape to twenty seconds before, As a table is the
 * ledger with a Read column, and an editor can leave one line on a death.
 * Nothing on the map drags, and every position is approximate by zone.
 *
 * Later on 10 Sep 2026, after the lead's screenshots: the long caption
 * under the square went (the corner note carries the sentence as its tip,
 * so the Rift can take the stage's whole height), five tiles beside the
 * legend show one seat at a time (the Rift hides the other seats' deaths
 * through `seatFilter`, and the legend, the strip, the table and the walk
 * follow, so the counts and "n / m" say what is on the map), and Full
 * screen gives the Rift the stage with the side column as a drawer (the
 * page's Escape, through `closeTick`, closes the drawer first and the full
 * screen next). None of it is stored; a visit opens on All, small.
 *
 * Part C (10 Sep 2026; the lead: "where do we have vision, safe zones and
 * danger zones, almost like a heat map"): when the timeline kept our wards
 * (version 3) a Vision heat pill beside the legend lays `buildHeat`'s cells
 * on the Rift, where our wards stood against where we died over the whole
 * game, and the corner note says the wards are approximate too. A death's
 * card gains Work on this second, which hands the page the death's second
 * for the tape to open the position lab on; only where the tape has frames.
 *
 * 11 Sep 2026, the lead again: "when clicking on the filters there is still
 * too much info, I want it to filter out and only show what is relevant to
 * the filtered objective or vision heat etc". **A filter now means focus**,
 * and both filters mean it the same way. A read takes every other death of
 * ours off the Rift along with the dots of theirs and the fight blobs, and
 * the strip, the table and the walk hold only the deaths it kept, so the
 * card's "n / N" counts the filtered set rather than the game. A seat does
 * what it did to the pins and now takes the dots and blobs it was not in
 * on. The legend's own counts stay the seat's, never the read's: they are
 * the choices on offer, so lighting Traded must not leave the other pills
 * reading nothing. The heat is cut here rather than in the map, since this
 * chapter builds the cells: the wards stay whole (where our vision was is a
 * team question, not a read), and the death patches follow the pins on the
 * map, which under a read filter is none of them. The heat is a filter of
 * its own (second fix pass, 11 Sep 2026): while it is lit the dots of theirs
 * and the fight blobs come off, so the square is our wards against our
 * deaths — the question the layer exists to answer — rather than everything
 * at once with a wash over it.
 *
 * The marks legend (`app-mark-legend`, 11 Sep 2026: "add a legend to
 * describe the icons used") sits in the legend row as one more pill and
 * opens a panel over the side column. The page's Escape folds it first,
 * before the table, the drawer and the full screen — one press, one thing.
 */
@Component({
  selector: 'app-film-map',
  imports: [FormsModule, TooltipDirective, FilmFrameComponent, RiftMapComponent, FilmGlyphComponent, DeathSceneComponent, MarkLegendComponent],
  template: `
    @let map = model().map;
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (map) {
        <div class="film-map is-open" [class.is-full]="full()" [class.is-drawer-closed]="full() && !drawer()">
          <div class="film-map-stage">
            <app-rift-map
              [pins]="map.pins"
              [theirs]="shownTheirs()"
              [clusters]="shownClusters()"
              [until]="null"
              [selected]="selectedKey()"
              [readFilter]="readFilter()"
              [seatFilter]="seatFilter()"
              [unreadKeys]="[]"
              [dim]="false"
              [note]="false"
              [heat]="heat()"
              [showHeat]="heatOn()"
              (pick)="jumpTo($event)"
            />
            <!-- The Rift's own corner note is off and this one stands in its place (10 Sep 2026): the same words, with the sentence that used to run under the square as its tip; the sentence stays in the DOM for a screen reader. With the heat on it gains the wards' clause (Part C). -->
            <span class="rift-map-note film-map-note" [appTip]="cornerTip()">{{ cornerText() }}</span>
            <p class="visually-hidden">{{ cornerTip() }}</p>
            @if (full() && !drawer()) {
              <button type="button" class="view-btn film-full-open" appTip="Bring the cards back" (click)="openDrawer()"><span class="material-symbols-rounded" aria-hidden="true">dock_to_right</span> Cards</button>
            }
          </div>

          <div class="film-map-side">
            @if (full()) {
              <button type="button" class="view-btn film-full-close" appTip="Close the drawer; the Rift stays full screen" (click)="closeDrawer()"><span class="material-symbols-rounded" aria-hidden="true">close</span> Close</button>
            }
            <p class="film-map-opening">
              @if (opening().count; as n) { <b #openingNum class="film-num" [attr.data-count]="n"></b> }
              <span>{{ opening().rest }}</span>
            </p>

            @if (map.pins.length) {
              <!-- One seat at a time (10 Sep 2026): the same tiles the tape wears; the legend's counts, the strip, the table and the walk all follow the seat. All resets. -->
              <div class="film-seat-tiles" data-tour="film-map-seats" role="group" aria-label="One seat at a time">
                <button type="button" class="film-seat-tile is-all" [class.active]="seatFilter() === 'all'" [attr.aria-pressed]="seatFilter() === 'all'" appTip="Every seat's deaths" (click)="pickSeat('all')">
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

              <!-- The counts are the seat's, never the read's: a lit read must leave the other pills reading what picking them would show (11 Sep 2026). -->
              <div class="film-legend" data-tour="film-map-legend" role="group" aria-label="Show the deaths by how the film reads them">
                <button type="button" class="view-btn" [class.active]="readFilter() === 'all'" [attr.aria-pressed]="readFilter() === 'all'" (click)="pickRead('all')">All <small>{{ seatPins().length }}</small></button>
                @for (r of readsPresent(); track r) {
                  <button type="button" [class]="'view-btn film-legend-read is-read-' + r" [class.active]="readFilter() === r" [attr.aria-pressed]="readFilter() === r" [attr.aria-label]="readLabels[r].label + ', ' + counts()[r]" [appTip]="readLabels[r].tip" (click)="toggleRead(r)">
                    <app-film-glyph [name]="readLabels[r].icon" /><span class="film-legend-word">{{ readLabels[r].label }}</span>{{ ' ' }}<small>{{ counts()[r] }}</small>
                  </button>
                }
                @if (hasWards()) {
                  <!-- The vision heat (Part C, 10 Sep 2026): only where the timeline kept our wards; the cells are the whole game's, never cut by the seat. -->
                  <button type="button" class="view-btn film-heat-btn film-layer-btn" [class.active]="heatOn()" [attr.aria-pressed]="heatOn()" [appTip]="heatTip" (click)="heatOn.set(!heatOn())"><app-film-glyph name="ward" /> Vision heat</button>
                }
                <button type="button" class="view-btn film-map-table-btn" [class.active]="table()" [attr.aria-pressed]="table()" (click)="table.set(!table())"><span class="material-symbols-rounded" aria-hidden="true">table_rows</span> As a table</button>
                <button type="button" class="view-btn film-full-btn" data-tour="film-map-full" [class.active]="full()" [attr.aria-pressed]="full()" [appTip]="full() ? 'Back to the map beside its cards' : 'The Rift takes the stage; the cards move into a drawer'" (click)="toggleFull()">
                  <span class="material-symbols-rounded" aria-hidden="true">{{ full() ? 'fullscreen_exit' : 'fullscreen' }}</span> {{ full() ? 'Exit full screen' : 'Full screen' }}
                </button>
                <!-- Every mark on the Rift, drawn with its sentence, over the side column; a panel, not a page and not a modal. -->
                <app-mark-legend [surface]="marks()" data-tour="film-map-marks" [(open)]="legendOpen" />
              </div>

              @if (costliest().length) {
                <div class="film-costliest" data-tour="film-costliest">
                  <span class="film-costliest-label">The ones that cost most</span>
                  <div class="film-costliest-cards">
                    @for (c of costliest(); track c.key) {
                      <button type="button" class="film-costliest-card" [style.--i]="$index" [class.active]="c.key === selectedKey()" [attr.aria-pressed]="c.key === selectedKey()" [appTip]="c.readLine" (click)="jumpTo(c.key)">
                        @if (c.champion) { <img class="film-costliest-tile" [src]="ui.championIconUrl(c.champion)" alt="" loading="lazy" /> }
                        <span class="film-costliest-who">{{ c.name || c.seat }}</span>
                        <span class="film-tape-min">{{ c.minute }} min</span>
                        @if (c.cost !== undefined) { <b class="film-costliest-cost">{{ signed(c.cost) }}</b> }
                      </button>
                    }
                  </div>
                </div>
              }

              @if (table()) {
                <div class="games-scroll film-map-table">
                  <table class="game-review-ledger-table">
                    <thead>
                      <tr><th scope="col" class="num">Min</th><th scope="col">Who</th><th scope="col">Where</th><th scope="col">How</th><th scope="col">Read</th><th scope="col">Could have been stopped by</th></tr>
                    </thead>
                    <tbody>
                      @for (d of walk(); track d.key) {
                        <tr [class.is-selected]="d.key === selectedKey()" [appTip]="d.readLine" (click)="jumpTo(d.key)">
                          <td class="num">{{ d.minute }}</td>
                          <td>@if (d.champion) { <img class="player-mark" [src]="ui.championIconUrl(d.champion)" alt="" loading="lazy" /> }{{ d.name || d.seat }} @if (d.name) { <small class="muted">{{ d.seat }}</small> }</td>
                          <td>{{ zone(d.zone) }}</td>
                          <td>{{ how(d.how) }}</td>
                          <td><span [class]="'film-read-badge is-read-' + d.read"><app-film-glyph [name]="readLabels[d.read].icon" />{{ readLabels[d.read].label }}</span></td>
                          <td>
                            @if (d.could.length) {
                              @for (c of d.could; track c) {
                                <span [class]="'could-chip is-' + c"><app-film-glyph [name]="couldGlyphs[c]" />{{ couldLabels[c].label }}</span>
                              }
                            } @else { <span class="muted">Nothing</span> }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else if (!walk().length) {
                <p class="film-wait">{{ waitLine() }}</p>
              } @else {
                <!-- Keyed on the death so a new one remounts the card: its drop and the scene's entrance play again for every death walked to. -->
                @for (p of shownPin(); track p.key) {
                  <article class="film-death-card" data-tour="film-death-card" [attr.data-read]="p.read">
                    <header class="film-death-head">
                      @if (p.champion) { <img class="film-death-icon" [src]="ui.championIconUrl(p.champion)" alt="" loading="lazy" /> }
                      <span class="film-death-who">
                        <b>{{ p.name || p.seat }}</b>
                        <small>{{ p.name ? p.seat + ' · ' : '' }}{{ p.champion ? ui.championName(p.champion) : '' }}</small>
                      </span>
                      <span class="film-death-meta">
                        <span class="film-tape-min">{{ p.minute }} min</span>
                        <span class="film-death-how">{{ how(p.how) }}</span>
                        <span class="film-death-zone">{{ zone(p.zone) }}</span>
                        <!-- How well this one spot is known (11 Sep 2026): every placed position on the film says so, and this one can now be the game's own answer rather than a sample inside the zone. -->
                        <span class="film-death-placed" [class.is-event]="p.placed === 'event'" [appTip]="placedTip(p)">{{ placedWord(p) }}</span>
                      </span>
                      <span class="film-death-n">{{ cursor() + 1 }} / {{ walk().length }}</span>
                    </header>

                    <span [class]="'film-read-badge is-read-' + p.read" [appTip]="readLabels[p.read].tip"><app-film-glyph [name]="readLabels[p.read].icon" />{{ readLabels[p.read].label }}</span>

                    <app-death-scene data-tour="film-death-scene" [scene]="p.scene" [read]="p.read" [champion]="p.champion" [name]="p.name" [active]="true" [label]="p.readLine" />

                    <p class="film-death-line" [class.is-ok]="p.read === 'bought'" [class.is-warn]="p.read === 'avoidable'">{{ p.readLine }}</p>
                    @if (cost(p); as c) { <p class="film-death-cost">{{ c }}</p> }
                    @if (p.line && p.line !== p.readLine) { <p class="film-death-ledger muted">{{ p.line }}</p> }
                    @if (p.could.length) {
                      <div class="film-death-tags" aria-label="What was missing">
                        @for (c of p.could; track c) {
                          <span [class]="'could-chip is-' + c" [appTip]="couldLabels[c].tip"><app-film-glyph [name]="couldGlyphs[c]" />{{ couldLabels[c].label }}</span>
                        }
                      </div>
                    }

                    <div class="film-notes film-death-notes">
                      @if (note(); as n) {
                        <p class="film-note"><span class="film-initial">{{ initials(n.by) }}</span>{{ n.text }}</p>
                      }
                      @if (auth.canEdit()) {
                        @if (noteOpen()) {
                          <form class="film-note-form" (submit)="saveNote($event, p)">
                            <label class="visually-hidden" for="filmDeathNote">A note on this death</label>
                            <input id="filmDeathNote" type="text" maxlength="200" placeholder="One line for the team" [ngModel]="noteText()" (ngModelChange)="noteText.set($event)" name="filmDeathNote" autocomplete="off" />
                            <button type="submit" class="view-btn active" [disabled]="!noteText().trim()">Save</button>
                            <button type="button" class="view-btn" (click)="noteOpen.set(false)">Cancel</button>
                          </form>
                        } @else {
                          <button type="button" class="view-btn" (click)="openNote()"><span class="material-symbols-rounded" aria-hidden="true">edit_note</span> {{ note() ? 'Change the note' : 'Add a note' }}</button>
                        }
                      }
                    </div>

                    <div class="film-death-actions">
                      <button type="button" class="view-btn" [disabled]="cursor() === 0" (click)="step(-1)"><span class="material-symbols-rounded" aria-hidden="true">arrow_back</span> Previous</button>
                      <button type="button" class="view-btn active" [disabled]="cursor() >= walk().length - 1" (click)="step(1)">{{ voice().nextDeath }} <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></button>
                      <button type="button" class="view-btn" [appTip]="'Open the tape twenty seconds before this death'" (click)="watch.emit(p.sec)"><span class="material-symbols-rounded" aria-hidden="true">play_circle</span> {{ voice().watchIt }}</button>
                      @if (hasFrames()) {
                        <button type="button" class="view-btn film-lab-btn" appTip="Open the position lab on the tape at this death's second: drag ours, try a ward, read the ground" (click)="lab.emit(p.sec)"><span class="material-symbols-rounded" aria-hidden="true">draw</span> Work on this second</button>
                      }
                    </div>
                  </article>
                }
              }
            } @else {
              <p class="film-wait">Nobody died. Keep doing that.</p>
            }
          </div>
        </div>
      } @else {
        <p class="film-wait">No death ledger for this game, so there is no map.</p>
      }
    </app-film-frame>
  `
})
export class FilmMapComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The map');
  readonly index = input<number>(2);
  readonly count = input<number>(1);
  /** Bumped by the page on Escape, and one press closes one thing: the marks panel, else the table and the note form, else the drawer, else the full screen (10 Sep 2026; the order and the one-thing rule 11 Sep 2026). */
  readonly closeTick = input<number>(0);
  /** A `closeTick` that closed something (the marks panel, the table, the note, the drawer, the full screen), so the page does not count that press towards leaving the film (10 Sep 2026, second fix pass). */
  readonly escaped = output<void>();
  /** Watch it: the second of the death, for the page to hand the tape. */
  readonly watch = output<number>();
  /** Work on this second (Part C, 10 Sep 2026): the death's second, for the page to hand the tape with the lab open on it. */
  readonly lab = output<number>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly auth = inject(AuthService);
  protected readonly ui = inject(UiService);
  private readonly motion = inject(MotionService);
  private readonly data = inject(TeamDataService);
  private readonly openingNum = viewChild<ElementRef<HTMLElement>>('openingNum');

  protected readonly readLabels = READ_LABELS;
  protected readonly couldLabels = COULD_LABELS;
  protected readonly couldGlyphs = COULD_GLYPHS;
  protected readonly approximateTip = APPROXIMATE_TIP;
  protected readonly heatTip = HEAT_TIP;
  /** The chrome's strings for this film: Next death, Watch it. Never the ledger's words. */
  protected readonly voice = computed(() => voiceOf(this.model().style));

  /** The vision heat layer, off until the pill turns it on. Per visit. */
  protected readonly heatOn = signal(false);
  /** Whether the timeline kept our wards (version 3; an empty list is a fact worth drawing, so it counts): the heat pill exists only then. */
  protected readonly hasWards = computed(() => Array.isArray(this.model().tape?.wards));
  /**
   * What this square draws, for the marks panel (11 Sep 2026, second fix
   * pass): the reads and their pins, the dots and the blobs, and the heat's
   * washes only where the timeline kept the wards to make them. No objective
   * glyph and no ward: the map chapter's Rift is given pins, dots, blobs and
   * the heat, and the tape is where the events and the vision layer live.
   */
  protected readonly marks = computed(() => ({ reads: true, theirs: true, heat: this.hasWards() }));
  /** Whether the timeline kept the positions: Work on this second exists only then, since the lab has nothing to stand the ten on otherwise. */
  protected readonly hasFrames = computed(() => (this.model().tape?.frames?.length ?? 0) > 0);
  /**
   * The heat's cells (11 Sep 2026): every ward of ours, whichever filter is
   * on, because where our vision stood is a team question and a ward carries
   * no read; and a patch per death the map is actually showing, so the wash
   * never says "we died all over" while the pins say one seat. A read filter
   * leaves the wards alone: the deaths of that read are already on the map
   * as pins, and washing them again would be the clutter the filter is for.
   */
  protected readonly heat = computed(() => {
    if (!this.hasWards()) return undefined;
    return buildHeat(this.model().tape?.wards, this.readFilter() === 'all' ? this.walk() : []);
  });
  /**
   * The dots of theirs on the square (11 Sep 2026, second fix pass). The Rift
   * applies the filters itself; the chapter cuts them here too so the corner
   * note and the heat can be read off what is actually drawn. None under a
   * read — a read is our verdict on our own death — the ones this seat was in
   * on under a seat, and none at all while the vision heat is on: that layer
   * is our wards against our deaths, and leaving the dots and the blobs under
   * it is the clutter the lead asked us to take off.
   */
  protected readonly shownTheirs = computed<FilmMap['theirs']>(() => {
    const map = this.model().map;
    if (!map || this.heatOn() || this.readFilter() !== 'all') return [];
    const seat = this.seatFilter();
    return seat === 'all' ? map.theirs : map.theirs.filter((t) => t.seats?.includes(seat));
  });

  /** The fight blobs, by the same rule: the fights this seat fell in, none under a read, and none under the heat. */
  protected readonly shownClusters = computed<FilmMap['clusters']>(() => {
    const map = this.model().map;
    if (!map || this.heatOn() || this.readFilter() !== 'all') return [];
    const seat = this.seatFilter();
    return seat === 'all' ? map.clusters : map.clusters.filter((c) => c.seats?.includes(seat));
  });

  /**
   * How the marks on this square were placed (11 Sep 2026, timeline version 4):
   * the pins and the dots the chapter is showing, read together — the shown
   * set and not the whole game (second fix pass), or a filtered square of
   * three zone-placed pins could sit under a note saying "Mostly where they
   * fell", with the pin card beside it saying the opposite of its own death. A
   * film built off an older document has no positions of its own and still
   * reads "Approximate, by zone"; one built off a version 4 document says the
   * deaths are where the game says they fell, and says so honestly when only
   * some are.
   */
  protected readonly placement = computed(() => placementOf([...this.walk(), ...this.shownTheirs()]));
  /** The corner note's words: how the deaths were placed, and the wards' clause while the heat shows. */
  protected readonly cornerText = computed(() => {
    const note = PLACEMENT_NOTES[this.placement()];
    return this.heatOn() && this.hasWards() ? `${note} · ${HEAT_NOTE}` : note;
  });
  protected readonly cornerTip = computed(() => {
    const tip = PLACEMENT_TIPS[this.placement()];
    return this.heatOn() && this.hasWards() ? `${tip} ${HEAT_TIP}` : tip;
  });

  protected readonly cursor = signal(0);
  protected readonly readFilter = signal<DeathReadKind | 'all'>('all');
  /** One seat of ours at a time, or every seat: the Rift's view and the side column's walk. Per visit. */
  protected readonly seatFilter = signal<Role | 'all'>('all');
  protected readonly table = signal(false);
  /** The marks legend's panel; the chapter holds it so the page's Escape can fold it before anything else. */
  protected readonly legendOpen = signal(false);
  protected readonly noteOpen = signal(false);
  protected readonly noteText = signal('');
  /** Full screen: the Rift takes the stage and the side column is a drawer; `drawer` is whether that drawer is open. Both per visit, never stored. */
  protected readonly full = signal(false);
  protected readonly drawer = signal(true);
  /** The game on the map; a string, so the walk below restarts only for another game and never for a rebuilt model of this one. */
  private readonly matchId = computed(() => this.model().matchId);

  /** The opening line split so its count can count up: "11" and " deaths: 6 avoidable, …"; "No deaths." has no count. */
  protected readonly opening = computed<{ count: string | null; rest: string }>(() => {
    const line = this.model().map?.opening ?? '';
    const m = /^(\d+)([\s\S]*)$/.exec(line);
    return m ? { count: m[1], rest: m[2] } : { count: null, rest: line };
  });
  /** Our five as tiles, in lane order, from the film's seats; a seat the review did not fill has no tile. */
  protected readonly seatTiles = computed<FilmSeatTile[]>(() => {
    const seats = this.model().seats;
    return ROLES.map((r) => seats.find((s) => s.seat === r))
      .filter((s): s is FilmSeat => !!s)
      .map((s) => ({ seat: s.seat, champion: s.champion, name: s.name }));
  });
  /** The seat's deaths, in the map's order: every pin, or one seat's under its view. What the legend counts and offers. */
  protected readonly seatPins = computed<FilmDeathPin[]>(() => {
    const pins = this.model().map?.pins ?? [];
    const seat = this.seatFilter();
    return seat === 'all' ? pins : pins.filter((p) => p.seat === seat);
  });
  /** The deaths the side column walks: the seat's, cut to the read in view (11 Sep 2026). The strip, the table, the card and its "n / N" all read this, so what is on the map is what is walked. */
  protected readonly walk = computed<FilmDeathPin[]>(() => {
    const read = this.readFilter();
    const pins = this.seatPins();
    return read === 'all' ? pins : pins.filter((p) => p.read === read);
  });
  /** How many of the seat's deaths fall under each read: the map's own counts under All, the seat's under a seat, never the read's own. */
  protected readonly counts = computed<Record<DeathReadKind, number>>(() => readCounts(this.seatPins().map((p) => p.read)));
  /** The reads that have a death in the walk, in the reads' own order. */
  protected readonly readsPresent = computed<DeathReadKind[]>(() => {
    const counts = this.counts();
    return DEATH_READS.filter((r) => counts[r] > 0);
  });
  /** The pins behind `map.costliest`, in its order, kept to the seat in view. */
  protected readonly costliest = computed<FilmDeathPin[]>(() => {
    const map = this.model().map;
    if (!map) return [];
    const walked = new Set(this.walk().map((p) => p.key));
    return map.costliest.map((key) => map.pins.find((p) => p.key === key)).filter((p): p is FilmDeathPin => !!p && walked.has(p.key));
  });
  /** What stands where the card would: the seat never died, or the read has nothing of theirs (which the legend's own counts keep from happening, but the walk is the truth on screen). */
  protected readonly waitLine = computed<string>(() => {
    const read = this.readFilter();
    if (read !== 'all' && !this.walk().length) return `No death of ours reads as ${READ_LABELS[read].label.toLowerCase()} here.`;
    const seat = this.seatFilter();
    return `${seat === 'all' ? 'Nobody' : seat} never died. Keep doing that.`;
  });
  protected readonly pin = computed<FilmDeathPin | undefined>(() => this.walk()[this.cursor()]);
  /** The pin on the card as a one-item list, so the template can key the card on it. */
  protected readonly shownPin = computed<FilmDeathPin[]>(() => {
    const p = this.pin();
    return p ? [p] : [];
  });
  protected readonly selectedKey = computed(() => this.pin()?.key ?? null);
  protected readonly note = computed<FilmNote | undefined>(() => {
    const key = this.pin()?.key;
    return key ? this.data.notesFor(this.model().matchId)?.notes[key] : undefined;
  });

  constructor() {
    // Escape from the page, one press for one thing (11 Sep 2026; until then a press with the table open in full screen folded
    // the table and the drawer at once): the marks legend first, then the table and the note, then the drawer, then the full
    // screen. A press that closed any of them says so through `escaped`, so the page's second-press rule (two Escapes within
    // two seconds go Back) only arms on a press that found nothing to close: Escape, Escape out of full screen used to drop the
    // reader on Games and lose the seat view with it (10 Sep 2026, second fix pass).
    effect(() => {
      this.closeTick();
      untracked(() => {
        if (this.legendOpen()) {
          this.legendOpen.set(false);
        } else if (this.table() || this.noteOpen()) {
          this.table.set(false);
          this.noteOpen.set(false);
        } else if (this.full()) {
          if (this.drawer()) this.drawer.set(false);
          else this.full.set(false);
        } else {
          return;
        }
        this.escaped.emit();
      });
    });

    // A new death on the card starts with the note form closed.
    effect(() => {
      this.cursor();
      untracked(() => this.noteOpen.set(false));
    });

    // A new game in the same component (the title card links film to film and the page is reused): the walk starts
    // over from the first death with every read and every seat lit, small, rather than standing on the last film's index (10 Sep 2026).
    effect(() => {
      this.matchId();
      untracked(() => {
        this.cursor.set(0);
        this.readFilter.set('all');
        this.seatFilter.set('all');
        this.table.set(false);
        this.legendOpen.set(false);
        this.full.set(false);
        this.drawer.set(true);
        this.heatOn.set(false);
      });
    });

    // The opening count counts up as the chapter shows.
    afterRenderEffect((onCleanup) => {
      const el = this.openingNum()?.nativeElement;
      if (!el) return;
      untracked(() => onCleanup(countText(this.motion, el, 900)));
    });
  }

  /** One read at a time on the legend; the same read again is All. */
  protected toggleRead(r: DeathReadKind): void {
    this.pickRead(this.readFilter() === r ? 'all' : r);
  }

  /**
   * The read in view, and where the card lands (11 Sep 2026): on the death
   * it was already on when the new filter keeps it, so lighting Avoidable
   * from an avoidable death does not throw the reader back to the first
   * one; on the first of the filtered set otherwise. Before the walk
   * followed the read at all, the card could sit on a death the map had
   * dimmed to nothing and count it "3 / 11".
   */
  protected pickRead(read: DeathReadKind | 'all'): void {
    const key = this.pin()?.key;
    this.readFilter.set(read);
    const i = key ? this.walk().findIndex((p) => p.key === key) : -1;
    this.cursor.set(i < 0 ? 0 : i);
  }

  /** One seat's view, or All: the walk starts over from that seat's first death. */
  protected pickSeat(seat: Role | 'all'): void {
    this.seatFilter.set(seat);
    this.cursor.set(0);
    this.table.set(false);
    // A read the new seat has no death under goes back to All (10 Sep 2026, second fix pass): its pill leaves the legend with the
    // seat, so a filter kept on it faded every pin of the seat with no lit pill, not even All, to say why.
    const read = this.readFilter();
    if (read !== 'all' && !this.counts()[read]) this.readFilter.set('all');
  }

  protected cost(p: FilmDeathPin): string {
    return costLine(p.cost);
  }

  protected signed(gold: number): string {
    return signedK(gold);
  }

  protected step(dir: 1 | -1): void {
    const n = this.walk().length;
    this.cursor.set(Math.min(Math.max(this.cursor() + dir, 0), Math.max(0, n - 1)));
  }

  /**
   * A pin tapped on the map, a costliest card, or a row in the table: the
   * card jumps to it. A key the filters do not keep (the selected pin is
   * never hidden, so the map can still hand one back) drops both filters
   * rather than the seat alone — dropping the seat while a read still hid
   * the death left the cursor where it was and the card on another death
   * (11 Sep 2026).
   */
  protected jumpTo(key: string): void {
    let i = this.walk().findIndex((p) => p.key === key);
    if (i < 0) {
      i = this.model().map?.pins.findIndex((p) => p.key === key) ?? -1;
      if (i < 0) return;
      this.seatFilter.set('all');
      this.readFilter.set('all');
    }
    this.cursor.set(i);
    this.table.set(false);
    // The tap is a question the card answers, so whatever stands in front of the card gets out of its way: the marks panel over
    // the column (11 Sep 2026), and in full screen the closed drawer (10 Sep 2026).
    this.legendOpen.set(false);
    if (this.full() && !this.drawer()) this.drawer.set(true);
  }

  /** Full screen on, with the drawer open; or off. Per visit. */
  protected toggleFull(): void {
    this.full.set(!this.full());
    this.drawer.set(true);
  }

  /**
   * The drawer goes and the marks panel goes with it (11 Sep 2026, second fix
   * pass): the panel lives in the side column, which full screen hides with
   * the drawer, so a panel left open behind it swallowed the next Escape —
   * one press, and nothing anybody could see moved.
   */
  protected closeDrawer(): void {
    this.drawer.set(false);
    this.legendOpen.set(false);
  }

  protected openDrawer(): void {
    this.drawer.set(true);
  }

  protected tileTip(s: FilmSeatTile): string {
    return s.name ? `${s.name} · ${s.seat} · ${s.champion}` : `${s.seat} · ${s.champion}`;
  }

  protected openNote(): void {
    this.noteText.set(this.note()?.text ?? '');
    this.noteOpen.set(true);
  }

  protected saveNote(event: Event, p: FilmDeathPin): void {
    event.preventDefault();
    const text = this.noteText().trim();
    if (!text) return;
    void this.data.saveFilmNote(this.model().matchId, p.key, text);
    this.noteText.set('');
    this.noteOpen.set(false);
  }

  protected initials(key: string): string {
    return initialsOf(key);
  }

  protected how(h: DeathHow): string {
    return HOW_LABELS[h] ?? h;
  }

  protected zone(z: MapZone): string {
    return ZONE_LABELS[z] ?? z;
  }

  /** Where this pin's spot came from, in two words on the card. */
  protected placedWord(p: FilmDeathPin): string {
    return p.placed === 'event' ? 'Where it happened' : 'Placed by zone';
  }

  protected placedTip(p: FilmDeathPin): string {
    return p.placed === 'event'
      ? 'The kill event carries its own position, so this pin is where the game says they fell.'
      : 'The timeline kept no position for this kill, so the pin is placed inside its zone and is approximate.';
  }
}
