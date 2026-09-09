import { Component, computed, inject, input, output } from '@angular/core';
import { FilmDeathPin, FilmMap, FilmTapeEvent } from '../../core/film-model';
import { DeathCould, Role } from '../../models/team.models';
import { MotionService } from '../../services/motion.service';
import { UiService } from '../../services/ui.service';
import { TooltipDirective } from '../tooltip.directive';

/** The most tokens the map draws at once; past that the oldest backs go first, then plates, firsts and their dots. */
export const MAX_TOKENS = 60;

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
  /** The Material Symbol for an objective or a first; empty otherwise. */
  icon: string;
  /** For a death of ours: the ledger key the chapter selects by, and the tags a filter reads. */
  pinKey?: string;
  could?: DeathCould[];
  /** The token's place in its own list (a pin's in `pins`, an event's in `events`), as `--i` for a staggered entrance. */
  order?: number;
}

/** The badge drawn beside a selected pin for each tag in its `could`. */
export const COULD_ICONS: Record<DeathCould, string> = {
  ward: 'visibility_off',
  jungle: 'alt_route',
  call: 'campaign',
  position: 'person_pin_circle'
};

const COULD_TIPS: Record<DeathCould, string> = {
  ward: 'A ward would have shown it',
  jungle: 'The jungler could have been there',
  call: 'A call would have pulled them out',
  position: 'Standing elsewhere would have done it'
};

/** The order tokens are dropped in when the map holds too many: the least telling first. */
const DROP_ORDER: RiftTokenKind[] = ['back', 'plate', 'first', 'theirDeath', 'objective', 'ourDeath'];

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
 */
@Component({
  selector: 'app-rift-map',
  imports: [TooltipDirective],
  host: { class: 'rift-map', '[class.is-dim]': 'dim()', '[class.is-still]': 'motion.reduced()', '[class.has-selection]': '!!selected()' },
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
            [class]="'rift-token is-' + tok.kind + (tok.side ? ' is-' + tok.side : '')"
            [class.is-selected]="tok.pinKey !== undefined && tok.pinKey === selected()"
            [class.is-unread]="unread(tok)"
            [class.is-faded]="faded(tok)"
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
                @if (tok.pinKey === selected() && tok.could?.length) {
                  <span class="rift-badges">
                    @for (tag of tok.could ?? []; track tag) {
                      <span class="rift-badge" [appTip]="tip(tag)"><span class="material-symbols-rounded" aria-hidden="true">{{ icon(tag) }}</span></span>
                    }
                  </span>
                }
              }
              @case ('theirDeath') {
                <span class="rift-dot"></span>
              }
              @case ('objective') {
                <span class="rift-obj"><span class="material-symbols-rounded" aria-hidden="true">{{ tok.icon }}</span></span>
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
  /** Pins not yet called: drawn hollow, and never faded by a filter, since their tags are not on the map yet. */
  readonly unreadKeys = input<readonly string[]>([]);
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

  /** Every token in time order, cut to `until` and capped at MAX_TOKENS. */
  protected readonly tokens = computed<RiftToken[]>(() => {
    const until = this.until();
    const pinKeys = new Set(this.pins().map((p) => p.key));
    const all: RiftToken[] = [];
    this.pins().forEach((p, i) => all.push(pinToken(p, i)));
    this.events().forEach((e, i) => {
      if (e.kind === 'ourDeath' && e.key && pinKeys.has(e.key)) return;
      all.push(eventToken(e, i));
    });
    this.theirs().forEach((d, i) => all.push(theirToken(d, i)));
    const shown = until === null ? all : all.filter((t) => t.sec <= until);
    shown.sort((a, b) => a.sec - b.sec || a.key.localeCompare(b.key));
    return capTokens(shown, MAX_TOKENS);
  });

  protected readonly selectedToken = computed(() => {
    const key = this.selected();
    return key ? this.tokens().find((t) => t.pinKey === key) : undefined;
  });

  private readonly unreadSet = computed(() => new Set(this.unreadKeys()));

  protected unread(tok: RiftToken): boolean {
    return tok.pinKey !== undefined && this.unreadSet().has(tok.pinKey);
  }

  protected faded(tok: RiftToken): boolean {
    const f = this.filter();
    return f !== 'all' && tok.kind === 'ourDeath' && !this.unread(tok) && !(tok.could ?? []).includes(f);
  }

  protected onTap(tok: RiftToken): void {
    this.tap.emit(tok);
    if (tok.pinKey) this.pick.emit(tok.pinKey);
  }

  protected icon(tag: DeathCould): string {
    return COULD_ICONS[tag] ?? 'label';
  }

  protected tip(tag: DeathCould): string {
    return COULD_TIPS[tag] ?? tag;
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
    icon: '',
    pinKey: p.key,
    could: p.could,
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
    icon: e.kind === 'objective' ? objectiveIcon(e.label) : '',
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
    icon: '',
    order: i
  };
}

/** The tape's objective labels carry the kind in words ("Their dragon (infernal)"); the icon reads it off them. */
export function objectiveIcon(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('baron')) return 'shield';
  if (l.includes('grub')) return 'bug_report';
  if (l.includes('herald')) return 'visibility';
  if (l.includes('dragon') || l.includes('drake') || l.includes('elder')) return 'pets';
  if (l.includes('atakhan')) return 'skull';
  if (l.includes('tower') || l.includes('turret')) return 'castle';
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
