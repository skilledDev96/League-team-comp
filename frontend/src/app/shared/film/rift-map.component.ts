import { Component, computed, inject, input, output } from '@angular/core';
import { DeathReadKind } from '../../core/death-reads';
import { COULD_GLYPHS, FilmDeathPin, FilmGlyph, FilmMap, FilmTapeEvent } from '../../core/film-model';
import { DeathCould, Role } from '../../models/team.models';
import { MotionService } from '../../services/motion.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../tooltip.directive';
import { FilmGlyphComponent, GLYPH_TIPS } from './film-glyph.component';

/** The most tokens the map draws at once; past that the oldest backs go first, then plates, firsts and their dots. */
export const MAX_TOKENS = 60;
/** How far from a moment's second a lit seat's token still rings, either way. */
export const LIT_WINDOW_SEC = 120;

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
 * the map filterable per champion to lose the clutter): that seat's deaths
 * and backs, the plates of its lane, every objective and first (the game's
 * landmarks, not clutter), and their deaths, which `faded` steps back. The
 * selected pin stays whichever seat it belongs to, so a filter never hides
 * what the reader is looking at. Pure; the tokens list shrinks by it before
 * the cap, so the seat's own tokens never lose their place to hidden ones.
 */
export function staysForSeat(tok: RiftToken, seat: Role, selected: string | null): boolean {
  if (tok.pinKey !== undefined && tok.pinKey === selected) return true;
  switch (tok.kind) {
    case 'ourDeath':
    case 'back':
      return tok.seat === seat;
    case 'plate':
      return plateLane(tok.label) === SEAT_LANE[seat];
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
 * the film room block) and `readFilter` fades the pins of the other reads
 * the way `filter` fades the other tags. The badges beside a selected pin
 * are the film's own glyphs (`app-film-glyph`), the pin's `glyphs` first and
 * its tags' glyphs when it carries none.
 *
 * `seatFilter` (10 Sep 2026, later the same day) is the per-champion view
 * the tape's and the map's tiles set: one seat of ours at a time. Unlike
 * the two filters above it hides rather than fades — our other seats'
 * deaths, backs and plates leave the list (`staysForSeat`) — while their
 * deaths fade and the objectives stay, so the seat's own story stands on a
 * quiet map. The host carries `has-seat-filter` while a seat is set.
 */
@Component({
  selector: 'app-rift-map',
  imports: [TooltipDirective, FilmGlyphComponent],
  host: { class: 'rift-map', '[class.is-dim]': 'dim()', '[class.is-still]': 'motion.reduced()', '[class.has-selection]': '!!selected()', '[class.has-seat-filter]': "seatFilter() !== 'all'" },
  template: `
    <div class="rift-map-square">
      <img class="rift-map-img" src="assets/maps/summoners-rift.png" alt="" draggable="false" />
      <svg class="rift-map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        @for (c of clusters(); track $index) {
          <circle class="rift-cluster" [attr.cx]="c.x" [attr.cy]="c.y" [attr.r]="c.r" [appTip]="c.line" />
        }
        @if (selectedToken(); as s) {
          <circle class="rift-ring" [attr.cx]="s.x" [attr.cy]="s.y" r="4.2" pathLength="100" />
          @if (s.could?.length) {
            <circle class="rift-ring is-outer" [attr.cx]="s.x" [attr.cy]="s.y" r="5.6" pathLength="100" />
          }
        }
      </svg>
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
        <span class="rift-map-note">Approximate, by zone</span>
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
  readonly theirs = input<{ x: number; y: number; minute: number }[]>([]);
  readonly clusters = input<FilmMap['clusters']>([]);
  /** Only what happened by this second shows; null shows everything. */
  readonly until = input<number | null>(null);
  /** The selected pin's ledger key. */
  readonly selected = input<string | null>(null);
  /** A pin whose `could` lacks this tag dims. */
  readonly filter = input<DeathCould | 'all'>('all');
  /** A pin whose read is not this one dims; the two filters stack. */
  readonly readFilter = input<DeathReadKind | 'all'>('all');
  /** One seat of ours at a time: the other seats' deaths, backs and plates hide, their deaths fade, objectives stay; the selected pin is never hidden. */
  readonly seatFilter = input<Role | 'all'>('all');
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
  /** A death of ours was tapped: its ledger key. */
  readonly pick = output<string>();
  /** Any token was tapped: the token itself, so the tape can show its label. */
  readonly tap = output<RiftToken>();

  protected readonly ui = inject(UiService);
  protected readonly motion = inject(MotionService);

  /** Every token in time order, cut to `until`, to the seat in view, and capped at MAX_TOKENS. */
  protected readonly tokens = computed<RiftToken[]>(() => {
    const until = this.until();
    const seat = this.seatFilter();
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
    // The seat's view hides rather than fades (10 Sep 2026): the list shrinks before the cap, so the seat's own tokens never lose their place to hidden ones.
    const shown = seat === 'all' ? byNow : byNow.filter((t) => staysForSeat(t, seat, selected));
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

  /** Faded by either filter, or their deaths under a seat's view; an unread pin never fades, since what it carries is not on the map yet. */
  protected faded(tok: RiftToken): boolean {
    // Under one seat's view their deaths step back so the seat's own stand out (10 Sep 2026); the objectives keep their weight, being the game's landmarks.
    if (tok.kind === 'theirDeath') return this.seatFilter() !== 'all';
    if (tok.kind !== 'ourDeath' || this.unread(tok)) return false;
    const f = this.filter();
    if (f !== 'all' && !(tok.could ?? []).includes(f)) return true;
    const r = this.readFilter();
    return r !== 'all' && tok.read !== r;
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
    ...(e.kind === 'objective' && { glyph: objectiveGlyph(e.label) }),
    pinKey: e.kind === 'ourDeath' ? e.key : undefined,
    order: i
  };
}

function theirToken(d: { x: number; y: number; minute: number }, i: number): RiftToken {
  return {
    key: `their:${d.minute}:${i}`,
    kind: 'theirDeath',
    sec: d.minute * 60,
    x: d.x,
    y: d.y,
    label: `One of theirs died at ${d.minute} min`,
    side: 'them',
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
