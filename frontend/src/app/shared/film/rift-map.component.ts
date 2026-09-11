import { Component, computed, inject, input, output } from '@angular/core';
import { DeathReadKind } from '../../core/death-reads';
import { placeAt, placementNote, wardsAt } from '../../core/film-build';
import { COULD_GLYPHS, FilmDeathPin, FilmFrame, FilmFramePlace, FilmGlyph, FilmMap, FilmPlacement, FilmTapeEvent, FilmWard } from '../../core/film-model';
import { DeathCould, Role, TimelineWardType } from '../../models/team.models';
import { MotionService } from '../../services/motion.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../tooltip.directive';
import { FilmGlyphComponent, GLYPH_TIPS } from './film-glyph.component';
import { clockText } from './film-scrubber.component';

/** The most tokens the map draws at once; past that the oldest backs go first, then plates, firsts and their dots. The layers (positions, wards, heat) never count. */
export const MAX_TOKENS = 60;
/** How far from a moment's second a lit seat's token still rings, either way. */
export const LIT_WINDOW_SEC = 120;
/**
 * How long a live token stays faded after a death of its seat (Part C, 10 Sep
 * 2026). The timeline carries no respawn, and a respawn timer runs from
 * about ten seconds at level one to over fifty late, so a flat twenty is the
 * simple, honest middle: long enough to read "fell here", short enough that
 * the token is back by the time the frame after moves it to the fountain.
 */
export const DEAD_WINDOW_SEC = 20;
/** The heat layer's opacity band: the lightest cell still reads as a wash, the heaviest never hides the Rift under it. */
export const HEAT_OPACITY_MIN = 0.08;
export const HEAT_OPACITY_MAX = 0.35;

/**
 * One cell of the vision heat map (Part C, 10 Sep 2026): where our wards
 * stood against where we died, over the whole game or a slice of it. The
 * chapter builds the cells (percent space, `r` in percent, `weight` 0 to 1);
 * the map only draws them, as a wash under everything, so "were we warding
 * the wrong side" is a look, not a figure.
 */
export interface FilmHeatCell {
  x: number;
  y: number;
  r: number;
  kind: 'ward' | 'death';
  weight: number;
}

/** One champion standing on the Rift at the clock second: ours in a ring of --accent, theirs faded in --warn, a champion in a seat and never a name. */
export interface RiftLiveToken {
  /** "us:Jungle" or "them:Jungle": stable across seconds, so the same element slides rather than a new one dropping in. */
  key: string;
  side: 'us' | 'them';
  seat: Role;
  champion?: string;
  x: number;
  y: number;
  /** "Our Jungle · Lee Sin" or "Their Jungle · Rammus"; the seat alone when the champion is unknown. */
  tip: string;
  /** A death of this seat fell within DEAD_WINDOW_SEC before the clock second. */
  dead: boolean;
}

/** A live ward of ours on the map: the ward itself plus the words for its mark. */
export interface RiftWardMark {
  key: string;
  ward: FilmWard;
  tip: string;
}

/**
 * A death of theirs as the map draws it (11 Sep 2026): the spot, the minute,
 * and — when the film carries it — which of our seats were in on the kill.
 * The seats are what a seat filter keeps a dot for; without them a dot is a
 * death the map cannot tie to the seat in view, so focusing on a seat drops
 * it. `FilmMap.theirs` carries them through from the timeline's own
 * `theirDeaths[].ourInvolved` (the Wire pass, 11 Sep 2026), so a seat's view
 * keeps every dot that seat was in on.
 */
export interface RiftTheirDeath {
  x: number;
  y: number;
  minute: number;
  seats?: Role[];
  /** Whether the spot is the kill event's own or the film's guess inside the zone; the corner note counts it (11 Sep 2026). */
  placed?: FilmPlacement;
}

/** Maps a heat cell's weight (0 to 1, clamped) onto the opacity band. */
export function heatOpacity(weight: number): number {
  const w = Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : 0));
  return HEAT_OPACITY_MIN + w * (HEAT_OPACITY_MAX - HEAT_OPACITY_MIN);
}

/** The words on a live token: side and seat, then the champion after a middle dot. Theirs is a champion in a seat, by the Riot rules; ours too, since a frame carries no player. */
export function liveTip(place: Pick<FilmFramePlace, 'seat' | 'champion'>, side: 'us' | 'them'): string {
  const who = `${side === 'us' ? 'Our' : 'Their'} ${place.seat}`;
  return place.champion ? `${who} · ${place.champion}` : who;
}

const WARD_WORDS: Record<TimelineWardType, string> = { trinket: 'Trinket ward', control: 'Control ward', other: 'Ward' };

/** The words on a ward mark: the kind, the seat, the clock it went down, and that it stands where the placer stood, because a ward event carries no position. */
export function wardTip(w: Pick<FilmWard, 'seat' | 'type' | 'sec'>): string {
  return `${WARD_WORDS[w.type] ?? WARD_WORDS.other}, ${w.seat}, placed ${clockText(w.sec)} · where the placer stood, approximate`;
}

/** Whether any of `deathSecs` fell within DEAD_WINDOW_SEC before `until` (a death at the second itself counts; one after it does not). */
export function diedWithin(deathSecs: readonly number[], until: number): boolean {
  return deathSecs.some((s) => s <= until && until - s <= DEAD_WINDOW_SEC);
}

/** How a rendered token looks, resolved once per event so the template only branches on `kind`. */
export type RiftTokenKind = 'ourDeath' | 'theirDeath' | 'objective' | 'first' | 'plate' | 'back';

export interface RiftToken {
  key: string;
  kind: RiftTokenKind;
  sec: number;
  x: number;
  y: number;
  label: string;
  /** Ours or theirs, for the tint; undefined on a plate or a back that carries no side. */
  side?: 'us' | 'them';
  seat?: Role;
  champion?: string;
  /** The film's glyph for an objective (10 Sep 2026: the same dragon the tape's card and the death scene draw, never a Material paw); absent otherwise. */
  glyph?: FilmGlyph;
  /** For a death of theirs: our seats that were in on the kill, when the film carries them; a seat filter keeps the dots that seat was in on. */
  seats?: Role[];
  /** For a death of ours: the ledger key the chapter selects by, and the tags a filter reads. */
  pinKey?: string;
  could?: DeathCould[];
  /** For a death of ours (cut 4, 10 Sep 2026): how the film reads it, for the pip's colour and the read filter. */
  read?: DeathReadKind;
  /** The imagery beside a selected pin, most telling first; the tags' glyphs when the pin carries none. */
  glyphs?: FilmGlyph[];
  /** The token's place in its own list (a pin's in `pins`, an event's in `events`), as `--i` for a staggered entrance. */
  order?: number;
}

/**
 * The tip beside each tag's glyph says what would have stopped the death,
 * which is more than the glyph's own name says; every other glyph (the
 * read's mark, an objective) keeps its name from `GLYPH_TIPS`.
 */
const COULD_TIPS: Record<DeathCould, string> = {
  ward: 'A ward would have shown it',
  jungle: 'The jungler could have been there',
  call: 'A call would have pulled them out',
  position: 'Standing elsewhere would have done it'
};

const GLYPH_COULD: Partial<Record<FilmGlyph, DeathCould>> = {
  'ward-off': 'ward',
  'jungler-far': 'jungle',
  horn: 'call',
  footsteps: 'position'
};

/** The order tokens are dropped in when the map holds too many: the least telling first. */
const DROP_ORDER: RiftTokenKind[] = ['back', 'plate', 'first', 'theirDeath', 'objective', 'ourDeath'];

type PlateLane = 'top' | 'mid' | 'bot';
/** The lane each seat's plates are in; the jungler has none, so a seat's view of the Jungle shows no plates. */
const SEAT_LANE: Record<Role, PlateLane | null> = { Top: 'top', Jungle: null, Mid: 'mid', ADC: 'bot', Support: 'bot' };

/** A plate token carries no seat, only its lane in the label ("2 plates down, bot, by 14 min"); the lane is read off it the way `objectiveGlyph` reads the kind. */
export function plateLane(label: string): PlateLane | null {
  const m = /\b(top|mid|bot)\b/i.exec(label);
  return m ? (m[1].toLowerCase() as PlateLane) : null;
}

/**
 * What one seat's view of the map keeps (10 Sep 2026, the lead asked for
 * the map filterable per champion to lose the clutter; 11 Sep 2026, the
 * lead again: "I want it to filter out and only show what is relevant"):
 * that seat's deaths and backs, the plates of its lane, every objective and
 * first (the game's landmarks, not clutter), and the deaths of theirs that
 * seat was in on. A dot the film cannot tie to the seat goes, the way a
 * fight blob without seats does; until 11 Sep 2026 every dot stayed, merely
 * faded, which is the clutter that was complained about. The selected pin
 * stays whichever seat it belongs to, so a filter never hides what the
 * reader is looking at. Pure; the tokens list shrinks by it before the cap,
 * so the seat's own tokens never lose their place to hidden ones.
 */
export function staysForSeat(tok: RiftToken, seat: Role, selected: string | null): boolean {
  if (tok.pinKey !== undefined && tok.pinKey === selected) return true;
  switch (tok.kind) {
    case 'ourDeath':
    case 'back':
      return tok.seat === seat;
    case 'plate':
      return plateLane(tok.label) === SEAT_LANE[seat];
    case 'theirDeath':
      return !!tok.seats?.includes(seat);
    default:
      return true;
  }
}

/**
 * What one read's view of the map keeps (11 Sep 2026): the deaths of ours
 * that the film reads that way, and the landmarks. A death of ours under
 * another read goes, and so does every dot of theirs — a read is our
 * verdict on our own death and says nothing about who of theirs fell — so
 * "Avoidable" leaves the avoidable deaths alone on the Rift rather than
 * dimming everything else behind them. The fight blobs go too, but that is
 * `shownClusters`, since a blob is not a token. The selected pin is kept
 * whatever the filter says, so the card and the map can never disagree.
 * A death of ours with no read at all (a tape event rather than a pin)
 * carries nothing to filter on, so it goes with the rest.
 */
export function staysForRead(tok: RiftToken, read: DeathReadKind, selected: string | null): boolean {
  if (tok.pinKey !== undefined && tok.pinKey === selected) return true;
  switch (tok.kind) {
    case 'ourDeath':
      return tok.read === read;
    case 'theirDeath':
      return false;
    default:
      return true;
  }
}

/**
 * The Rift with a game on it (9 Sep 2026): the PNG as a square, blue base
 * bottom-left and red top-right, an SVG under the tokens for the fight
 * clusters and the selected pin's ring, and every event as a percent-placed
 * token that drops in the moment it first appears. The tape feeds it events
 * and a clock second; the map chapter feeds it the death pins, the selection
 * and a filter; the takeover's reel feeds it events alone. Nothing here
 * drags or pans, and every position came out of a zone bucket, so the corner
 * says so.
 *
 * Their deaths are dots and their objectives icons: a seat and a champion at
 * most, never a name, by the Riot rules. A death of ours is a button that
 * emits `pick` with its ledger key; the rest are buttons only so their
 * tooltips reach the keyboard.
 *
 * Cut 4 (10 Sep 2026): a pin carries the film's read of the death, so the
 * pip wears the read's colour (`is-read-avoidable` and the rest, tokens in
 * the film room block). The badges beside a selected pin
 * are the film's own glyphs (`app-film-glyph`), the pin's `glyphs` first and
 * its tags' glyphs when it carries none.
 *
 * **A filter means focus** (11 Sep 2026, the lead: "when clicking on the
 * filters there is still too much info, I want it to filter out and only
 * show what is relevant"). One rule for both filters: what the filter is
 * not about leaves the map rather than dimming behind it.
 * - `seatFilter` is the per-champion view the tape's and the map's tiles
 *   set: that seat's deaths and backs, its lane's plates, the dots of
 *   theirs it was in on (`staysForSeat`), and the fight blobs it fell in
 *   (`shownClusters`); the objectives and firsts stay, being the game's
 *   landmarks. The host carries `has-seat-filter` while a seat is set.
 * - `readFilter` is the map chapter's legend: only the deaths of ours the
 *   film reads that way (`staysForRead`), no dots of theirs and no blobs,
 *   since neither carries a read. The live and the vision layers stand
 *   through it: where the ten walked and where a ward stood is not a
 *   verdict on a death. The host carries `has-read-filter`.
 * - The two combine, and the selected pin is never hidden by either.
 * - The heat is the host's to cut: the chapter builds the cells, so it
 *   decides which deaths are washed and leaves the wards alone.
 * `filter` (the ledger's tags) is the one filter that still only fades; no
 * chapter sets it since the reads replaced the tag legend, and the tape
 * would rather step a tag back than take a death off its own timeline.
 *
 * The layers (Part C, 10 Sep 2026; the lead: "we want to see where our
 * vision was placed" and "where do we have vision, safe zones and danger
 * zones, almost like a heat map"). Three layers stand under the event
 * tokens, and none counts against MAX_TOKENS, since a layer is not a
 * token: it may draw ten champions and every live ward.
 * - `.rift-live`: everyone on the map. `frames` are the timeline's once-a-
 *   minute positions in percent space; `placeAt` interpolates the ten to the
 *   clock second (`until`), and each token moves on transform alone (a
 *   300 ms transition in the film room block, none with motion off, so they
 *   jump). Ours wear the champion tile ringed in --accent with the seat
 *   under it on hover; theirs the tile faded and ringed in --warn, the seat
 *   only. A seat of ours whose death fell within DEAD_WINDOW_SEC before the
 *   second fades (`is-dead`); the timeline says nothing about respawns.
 *   `seatFilter` keeps that seat of ours and all of theirs. With no clock
 *   second (the map chapter's `until` is null) the layer has nowhere to
 *   stand and stays off.
 * - `.rift-vision`: our wards. A ward event carries no position, so each
 *   mark stands where the placer stood at the nearest frame, and every
 *   word about it says so; a ward shows from its placing until its end
 *   (`wardsAt`), a control ward in --accent-2 and a trinket in --ok, with
 *   its sight as a dashed circle in the SVG. The seat filter keeps that
 *   seat's wards.
 * - `.rift-heat`: the vision heat map, cells the chapter builds
 *   (`FilmHeatCell`), a wash of --ok for wards and --warn for deaths whose
 *   opacity follows the weight, drawn first in the SVG so everything else
 *   stands on it. Not cut by the clock or the seat: the cells are the
 *   whole game's.
 * The corner note gains "positions once a minute" and "wards where the
 * placer stood" while those layers show, so every placed position on the
 * map says approximate.
 */
@Component({
  selector: 'app-rift-map',
  imports: [TooltipDirective, FilmGlyphComponent],
  host: {
    class: 'rift-map',
    '[class.is-dim]': 'dim()',
    '[class.is-still]': 'motion.reduced()',
    '[class.has-selection]': '!!selected()',
    '[class.has-seat-filter]': "seatFilter() !== 'all'",
    '[class.has-read-filter]': "readFilter() !== 'all'",
    '[class.has-live]': 'live().length > 0',
    '[class.has-vision]': 'vision().length > 0',
    '[class.has-heat]': 'heatCells().length > 0'
  },
  template: `
    <div class="rift-map-square">
      <img class="rift-map-img" src="assets/maps/summoners-rift.png" alt="" draggable="false" />
      <svg class="rift-map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <!-- The heat first, so the fights, the sight and the rings all stand on it. -->
        @for (h of heatCells(); track $index) {
          <circle [class]="'rift-heat is-' + h.kind" [attr.cx]="h.x" [attr.cy]="h.y" [attr.r]="h.r" [attr.opacity]="heatOpacity(h.weight)" />
        }
        @for (m of vision(); track m.key) {
          <circle [class]="'rift-sight is-' + m.ward.type" [attr.cx]="m.ward.x" [attr.cy]="m.ward.y" [attr.r]="m.ward.r" />
        }
        @for (c of shownClusters(); track $index) {
          <circle class="rift-cluster" [attr.cx]="c.x" [attr.cy]="c.y" [attr.r]="c.r" [appTip]="c.line" />
        }
        @if (selectedToken(); as s) {
          <circle class="rift-ring" [attr.cx]="s.x" [attr.cy]="s.y" r="4.2" pathLength="100" />
          @if (s.could?.length) {
            <circle class="rift-ring is-outer" [attr.cx]="s.x" [attr.cy]="s.y" r="5.6" pathLength="100" />
          }
        }
      </svg>
      <!-- The layers stand under the event tokens (10 Sep 2026): a death's pip lands on top of the champion who fell, and a selected pin's badges are never covered. Neither layer takes pointer events; the marks and tiles do, for their tips. -->
      @if (vision().length) {
        <div class="rift-vision" role="group" aria-label="Our wards, where the placer stood, approximate">
          @for (m of vision(); track m.key) {
            <span [class]="'rift-ward is-' + m.ward.type" [style.left.%]="m.ward.x" [style.top.%]="m.ward.y" role="img" [attr.aria-label]="m.tip" [appTip]="m.tip">
              <app-film-glyph name="ward" [size]="0.7" />
            </span>
          }
        </div>
      }
      @if (live().length) {
        <div class="rift-live" role="group" aria-label="Where everyone stood, approximate, positions once a minute">
          @for (p of live(); track p.key) {
            <!-- A full-size box slid by its place in percent of itself (its box is the square, so x% of it is x% of the map): the one way to move on transform alone; the tile sits at the box's origin. -->
            <div [class]="'rift-live-token is-' + (p.side === 'us' ? 'ours' : 'theirs')" [class.is-dead]="p.dead" [style.transform]="'translate(' + p.x + '%, ' + p.y + '%)'" [attr.data-seat]="p.seat">
              <span class="rift-live-tile" role="img" [attr.aria-label]="p.tip" [appTip]="p.tip">
                @if (p.champion) {
                  <img class="rift-live-img" [src]="ui.championIconUrl(p.champion)" alt="" loading="lazy" draggable="false" />
                } @else {
                  <span class="rift-live-fallback" aria-hidden="true">{{ p.seat.charAt(0) }}</span>
                }
                <small class="rift-live-seat" aria-hidden="true">{{ p.seat }}</small>
              </span>
            </div>
          }
        </div>
      }
      <div class="rift-tokens">
        @for (tok of tokens(); track tok.key) {
          <button
            type="button"
            [class]="'rift-token is-' + tok.kind + (tok.side ? ' is-' + tok.side : '') + (tok.read ? ' is-read-' + tok.read : '')"
            [class.is-selected]="tok.pinKey !== undefined && tok.pinKey === selected()"
            [class.is-unread]="unread(tok)"
            [class.is-faded]="faded(tok)"
            [class.is-lit]="lit(tok)"
            [style.left.%]="tok.x"
            [style.top.%]="tok.y"
            [style.--i]="tok.order ?? 0"
            [attr.aria-label]="tok.label"
            [attr.aria-pressed]="tok.pinKey !== undefined ? tok.pinKey === selected() : null"
            [appTip]="tok.label"
            (click)="onTap(tok)"
          >
            @switch (tok.kind) {
              @case ('ourDeath') {
                <span class="rift-pip">
                  @if (tok.champion) {
                    <img class="rift-pip-img" [src]="ui.championIconUrl(tok.champion)" alt="" loading="lazy" draggable="false" />
                  } @else {
                    <span class="material-symbols-rounded" aria-hidden="true">skull</span>
                  }
                </span>
                @if (tok.pinKey === selected() && badges(tok).length) {
                  <span class="rift-badges">
                    @for (g of badges(tok); track $index) {
                      <span class="rift-badge" [appTip]="tip(g)"><app-film-glyph [name]="g" /></span>
                    }
                  </span>
                }
              }
              @case ('theirDeath') {
                <span class="rift-dot"></span>
              }
              @case ('objective') {
                <span class="rift-obj"><app-film-glyph [name]="tok.glyph ?? 'flag'" /></span>
              }
              @case ('first') {
                <span class="rift-first">1st</span>
              }
              @case ('plate') {
                <span class="rift-plate"></span>
              }
              @case ('back') {
                <span class="rift-back"></span>
              }
            }
          </button>
        }
      </div>
      @if (showCurveHint()) {
        <span class="rift-map-hint"><span class="material-symbols-rounded" aria-hidden="true">show_chart</span> The gold curve shows once you lock a guess</span>
      }
      @if (note()) {
        <span class="rift-map-note">{{ noteText() }}</span>
      }
    </div>
    <div class="rift-map-caption"><ng-content select="[caption]" /></div>
  `
})
export class RiftMapComponent {
  /** The tape's events, in time order. */
  readonly events = input<FilmTapeEvent[]>([]);
  /** The map chapter's death pins; a pin outranks the tape event with the same key. */
  readonly pins = input<FilmDeathPin[]>([]);
  readonly theirs = input<RiftTheirDeath[]>([]);
  readonly clusters = input<FilmMap['clusters']>([]);
  /** Only what happened by this second shows; null shows everything. */
  readonly until = input<number | null>(null);
  /** The selected pin's ledger key. */
  readonly selected = input<string | null>(null);
  /** A pin whose `could` lacks this tag dims; the one filter that fades rather than focuses, and nothing sets it today. */
  readonly filter = input<DeathCould | 'all'>('all');
  /** Only the deaths of ours the film reads this way stay on the map; their dots and the fight blobs go with them. The two filters stack. */
  readonly readFilter = input<DeathReadKind | 'all'>('all');
  /** One seat of ours at a time: the other seats' deaths, backs and plates go, so do the dots and blobs that seat was not in, objectives stay; the selected pin is never hidden. */
  readonly seatFilter = input<Role | 'all'>('all');
  /**
   * The fight blobs a filter leaves: under a seat, the fights that seat fell
   * in; under a read, none at all, because a blob is a fight and not a read
   * (11 Sep 2026). A blob that carries no seats hides with any seat filter
   * (the lead saw the river fight stay red under Top, 10 Sep 2026).
   */
  protected readonly shownClusters = computed(() => {
    if (this.readFilter() !== 'all') return [];
    const seat = this.seatFilter();
    const all = this.clusters();
    return seat === 'all' ? all : all.filter((c) => c.seats?.includes(seat));
  });
  /** Pins not yet called: drawn hollow, and never faded by a filter, since their tags are not on the map yet. */
  readonly unreadKeys = input<readonly string[]>([]);
  /** Seats of ours to light with an accent ring: the tape passes a moment's seats while the hand pauses on it. */
  readonly highlightSeats = input<readonly Role[]>([]);
  /** The second the lit seats are about: only their tokens within LIT_WINDOW_SEC of it light. Null lights the seat's every token. */
  readonly highlightSec = input<number | null>(null);
  readonly dim = input<boolean>(false);
  readonly showCurveHint = input<boolean>(false);
  /** The "Approximate, by zone" corner note; off where nothing on the map came out of a zone. */
  readonly note = input<boolean>(true);
  /** Where the ten stood once a minute, percent space (timeline version 3); absent on an older document, and the live layer stays off. */
  readonly frames = input<FilmFrame[] | undefined>(undefined);
  /** The live layer's switch: everyone on the map, moving between frames. On by default; a chapter turns it off to leave the deaths alone. */
  readonly showEveryone = input<boolean>(true);
  /** Our wards with their sight, percent space (timeline version 3). */
  readonly wards = input<FilmWard[] | undefined>(undefined);
  /** The vision layer's switch, off by default: the chapter's toggle turns it on. */
  readonly showVision = input<boolean>(false);
  /** The heat map's cells, built by the chapter; the map only draws them. */
  readonly heat = input<FilmHeatCell[] | undefined>(undefined);
  /** The heat layer's switch, off by default. */
  readonly showHeat = input<boolean>(false);
  /** A death of ours was tapped: its ledger key. */
  readonly pick = output<string>();
  /** Any token was tapped: the token itself, so the tape can show its label. */
  readonly tap = output<RiftToken>();

  protected readonly ui = inject(UiService);
  protected readonly motion = inject(MotionService);
  protected readonly heatOpacity = heatOpacity;

  /**
   * Every death by side and seat, from the pins and the tape's events (a pin
   * and its event carry the same second, and a duplicate second changes
   * nothing). Their deaths carry no seat on the tape, so a token of theirs
   * never fades: the map cannot say which of them fell.
   */
  private readonly deathSecs = computed<Map<string, number[]>>(() => {
    const out = new Map<string, number[]>();
    const add = (side: 'us' | 'them', seat: Role | undefined, sec: number) => {
      if (!seat) return;
      const key = `${side}:${seat}`;
      const list = out.get(key);
      if (list) list.push(sec);
      else out.set(key, [sec]);
    };
    for (const p of this.pins()) add('us', p.seat, p.sec);
    for (const e of this.events()) {
      if (e.kind === 'ourDeath') add('us', e.seat, e.sec);
      else if (e.kind === 'theirDeath') add('them', e.seat, e.sec);
    }
    return out;
  });

  /** The ten at the clock second: ours (that seat alone under the seat filter) then theirs, each keyed by side and seat so the same element slides between seconds. */
  protected readonly live = computed<RiftLiveToken[]>(() => {
    const frames = this.frames();
    const until = this.until();
    if (!this.showEveryone() || !frames?.length || until === null) return [];
    const at = placeAt(frames, until);
    if (!at) return [];
    const seat = this.seatFilter();
    const deaths = this.deathSecs();
    const token = (p: FilmFramePlace, side: 'us' | 'them'): RiftLiveToken => ({
      key: `${side}:${p.seat}`,
      side,
      seat: p.seat,
      champion: p.champion,
      x: p.x,
      y: p.y,
      tip: liveTip(p, side),
      dead: diedWithin(deaths.get(`${side}:${p.seat}`) ?? [], until)
    });
    const ours = at.ours.filter((p) => seat === 'all' || p.seat === seat).map((p) => token(p, 'us'));
    const theirs = at.theirs.map((p) => token(p, 'them'));
    return [...ours, ...theirs];
  });

  /** The wards standing at the clock second as `wardsAt` reads it (placed by then and not yet gone; the very second one ends it still shows), that seat's alone under the seat filter; off without a second, since "standing at" needs one. */
  protected readonly vision = computed<RiftWardMark[]>(() => {
    const wards = this.wards();
    const until = this.until();
    if (!this.showVision() || !wards?.length || until === null) return [];
    const seat = this.seatFilter();
    // Keyed by the ward's place in the input, not in the live list, so a mark keeps its element when an earlier ward expires.
    return wardsAt(wards, until)
      .filter((w) => seat === 'all' || w.seat === seat)
      .map((w) => ({ key: `w:${wards.indexOf(w)}`, ward: w, tip: wardTip(w) }));
  });

  /** The heat cells while the layer is on; never cut by the clock or the seat, since the cells are the whole game's. */
  protected readonly heatCells = computed<FilmHeatCell[]>(() => (this.showHeat() ? (this.heat() ?? []) : []));

  /**
   * The corner note: how the marks on the square were placed, and a clause per
   * layer that places something another way. Since timeline version 4 (11 Sep
   * 2026) the first clause is the truth of what is drawn rather than a fixed
   * sentence — `placementNote` reads every mark the map has, so a square of
   * deaths off their own kill events says so instead of apologising by zone.
   */
  protected readonly noteText = computed(() => {
    const parts = [placementNote([...this.pins(), ...this.events(), ...this.theirs()])];
    if (this.live().length) parts.push('positions once a minute');
    if (this.vision().length) parts.push('wards where the placer stood');
    return parts.join(' · ');
  });

  /** Every token in time order, cut to `until`, to the seat in view, to the read in view, and capped at MAX_TOKENS. */
  protected readonly tokens = computed<RiftToken[]>(() => {
    const until = this.until();
    const seat = this.seatFilter();
    const read = this.readFilter();
    const selected = this.selected();
    const pinKeys = new Set(this.pins().map((p) => p.key));
    const all: RiftToken[] = [];
    this.pins().forEach((p, i) => all.push(pinToken(p, i)));
    this.events().forEach((e, i) => {
      if (e.kind === 'ourDeath' && e.key && pinKeys.has(e.key)) return;
      all.push(eventToken(e, i));
    });
    this.theirs().forEach((d, i) => all.push(theirToken(d, i)));
    const byNow = until === null ? all : all.filter((t) => t.sec <= until);
    // Both filters hide rather than fade (the seat's view since 10 Sep 2026, the read's since 11 Sep): the list shrinks before the cap, so what a filter keeps never loses its place to what it hid.
    const bySeat = seat === 'all' ? byNow : byNow.filter((t) => staysForSeat(t, seat, selected));
    const shown = read === 'all' ? bySeat : bySeat.filter((t) => staysForRead(t, read, selected));
    shown.sort((a, b) => a.sec - b.sec || a.key.localeCompare(b.key));
    return capTokens(shown, MAX_TOKENS);
  });

  protected readonly selectedToken = computed(() => {
    const key = this.selected();
    return key ? this.tokens().find((t) => t.pinKey === key) : undefined;
  });

  private readonly unreadSet = computed(() => new Set(this.unreadKeys()));
  private readonly litSeats = computed(() => new Set(this.highlightSeats()));

  protected unread(tok: RiftToken): boolean {
    return tok.pinKey !== undefined && this.unreadSet().has(tok.pinKey);
  }

  /** A token of ours whose seat the chapter is pointing at, near the second it is pointing at (a Jungle moment at 25 min never rings the jungler's death at 4). */
  protected lit(tok: RiftToken): boolean {
    if (tok.seat === undefined || !this.litSeats().has(tok.seat)) return false;
    const at = this.highlightSec();
    return at === null || Math.abs(tok.sec - at) <= LIT_WINDOW_SEC;
  }

  /**
   * Faded by the tag filter alone (11 Sep 2026). The seat's and the read's
   * views take a token off the map instead, so nothing that stays needs
   * dimming: a dot of theirs at full weight is one the seat was in on, and
   * every pin left is the read that was asked for. An unread pin never
   * fades, since what it carries is not on the map yet.
   */
  protected faded(tok: RiftToken): boolean {
    if (tok.kind !== 'ourDeath' || this.unread(tok)) return false;
    const f = this.filter();
    return f !== 'all' && !(tok.could ?? []).includes(f);
  }

  protected onTap(tok: RiftToken): void {
    this.tap.emit(tok);
    if (tok.pinKey) this.pick.emit(tok.pinKey);
  }

  /** The glyphs beside a selected pin: the pin's own, else its tags' in the ledger's order. */
  protected badges(tok: RiftToken): FilmGlyph[] {
    return tok.glyphs?.length ? tok.glyphs : (tok.could ?? []).map((c) => COULD_GLYPHS[c]);
  }

  protected tip(g: FilmGlyph): string {
    const could = GLYPH_COULD[g];
    return could ? COULD_TIPS[could] : (GLYPH_TIPS[g] ?? g);
  }
}

function pinToken(p: FilmDeathPin, order: number): RiftToken {
  const who = p.name ? `${p.name} (${p.seat})` : p.seat;
  return {
    key: 'pin:' + p.key,
    kind: 'ourDeath',
    sec: p.sec,
    x: p.x,
    y: p.y,
    label: p.line || `${who} died at ${p.minute} min`,
    side: 'us',
    seat: p.seat,
    champion: p.champion,
    pinKey: p.key,
    could: p.could,
    read: p.read,
    glyphs: p.glyphs,
    order
  };
}

function eventToken(e: FilmTapeEvent, i: number): RiftToken {
  return {
    key: e.key ? 'ev:' + e.key : `ev:${e.kind}:${e.sec}:${i}`,
    kind: e.kind,
    sec: e.sec,
    x: e.x,
    y: e.y,
    label: e.label,
    side: e.side,
    seat: e.seat,
    champion: e.champion,
    // Our seats on a death of theirs, when the tape carries them: the same rule `theirToken` gives the map's dots, so a
    // seat filter on the tape keeps the kills that seat was in on instead of clearing the square (11 Sep 2026, second fix pass).
    ...(e.seats?.length && { seats: e.seats.slice() }),
    ...(e.kind === 'objective' && { glyph: objectiveGlyph(e.label) }),
    pinKey: e.kind === 'ourDeath' ? e.key : undefined,
    order: i
  };
}

function theirToken(d: RiftTheirDeath, i: number): RiftToken {
  return {
    key: `their:${d.minute}:${i}`,
    kind: 'theirDeath',
    sec: d.minute * 60,
    x: d.x,
    y: d.y,
    label: `One of theirs died at ${d.minute} min`,
    side: 'them',
    // Our seats on the kill, when the film carries them: what a seat filter keeps the dot for (11 Sep 2026).
    ...(d.seats?.length && { seats: d.seats.slice() }),
    order: i
  };
}

/** The tape's objective labels carry the kind in words ("Their dragon (infernal)"); the glyph reads it off them, so the pit shows the same dragon the tape's card and the death scene draw. */
export function objectiveGlyph(label: string): FilmGlyph {
  const l = label.toLowerCase();
  if (l.includes('baron')) return 'baron';
  if (l.includes('grub')) return 'grubs';
  if (l.includes('herald')) return 'herald';
  if (l.includes('dragon') || l.includes('drake') || l.includes('elder')) return 'dragon';
  if (l.includes('atakhan')) return 'atakhan';
  if (l.includes('tower') || l.includes('turret')) return 'tower';
  return 'flag';
}

/** Keep at most `max` tokens: the oldest backs go first, then plates, firsts, their dots, objectives, and only then a death of ours. */
export function capTokens(tokens: RiftToken[], max: number): RiftToken[] {
  if (tokens.length <= max) return tokens;
  const keep = new Set(tokens);
  let over = tokens.length - max;
  for (const kind of DROP_ORDER) {
    if (over <= 0) break;
    for (const t of tokens) {
      if (over <= 0) break;
      if (t.kind !== kind) continue;
      keep.delete(t);
      over--;
    }
  }
  return tokens.filter((t) => keep.has(t));
}
