import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DeathReadKind, READ_LABELS } from '../../core/death-reads';
import { FilmDeathScene, FilmGlyph, OBJECTIVE_GLYPHS } from '../../core/film-model';
import { ZONE_LABELS } from '../../core/review-view';
import { UiService } from '../../services/ui.service';
import { FILM_GLYPHS, FilmGlyphShape } from './film-glyph.component';

/** How many hostile marks the scene fans toward the victim at most; past five they stop meaning anything. */
export const MAX_HOSTILES = 5;
/** How many ally dots sit beside the victim at most. */
export const MAX_ALLIES = 4;

/** The centre of the victim's tile, in scene units. */
const VICTIM = { x: 120, y: 88 };
/** How far out the hostile marks stand from the victim. */
const HOSTILE_RADIUS = 40;

/**
 * Where the hostile marks stand, by how many came in: fanned across the
 * upper right, the side their tower is drawn on, so the eye reads "they came
 * from there". Angles in degrees, clockwise from three o'clock the way SVG
 * turns; nothing past -65, or the first mark lands on the objective's caption
 * at the top, and nothing past -5, or the last sits on the jungler's line.
 */
const HOSTILE_FANS: Record<number, number[]> = {
  1: [-35],
  2: [-60, -20],
  3: [-65, -38, -10],
  4: [-65, -45, -25, -5],
  5: [-65, -50, -35, -20, -5]
};

export interface HostileMark {
  x: number;
  y: number;
  /** The wedge points along +x; this turns it at the victim. */
  rotate: number;
}

/** The hostile marks for `killers` who came in, at most MAX_HOSTILES, each turned to face the victim. */
export function hostileMarks(killers: number): HostileMark[] {
  const n = Math.max(0, Math.min(MAX_HOSTILES, Math.floor(killers)));
  if (!n) return [];
  return HOSTILE_FANS[n].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x: Math.round((VICTIM.x + HOSTILE_RADIUS * Math.cos(rad)) * 10) / 10,
      y: Math.round((VICTIM.y + HOSTILE_RADIUS * Math.sin(rad)) * 10) / 10,
      rotate: deg + 180
    };
  });
}

/**
 * One death of ours as a chalkboard panel (cut 4, 10 Sep 2026): the victim
 * in the middle on a patch of ground, and around them only what the ledger
 * and the timeline can say about it, each thing with a caption of a word or
 * three. No ward: a slashed ward in a bush at the left. The jungler a screen
 * away: their tile far right with a dashed line back. A call: their jungler
 * top left with an arrow already pointing in. Standing on their side: a
 * dashed midline with the victim past it. An objective in the window: its
 * glyph up top with a glow. A trade: crossed swords with the count. A tower:
 * looming behind. Allies near, or alone. And the ones who came in, as wedges
 * fanned toward the victim. Nothing here asks anything; the read line the
 * caller passes as `label` is the whole sentence.
 *
 * Their jungler is a champion in a seat, never a name (Riot rule); ours may
 * carry a name. Every position is a place on a panel, not on the map, so
 * nothing here claims where on the Rift it happened.
 *
 * The entrance: each part carries `--i` in story order, and when the host is
 * active in the current chapter with motion on the parts rise in one after
 * another and the arrow draws itself (CSS under `.death-scene.is-active`);
 * still, they are simply there.
 */
@Component({
  selector: 'app-death-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'death-scene-host', '[class.is-active]': 'active()' },
  template: `
    @let s = scene();
    <svg class="death-scene" viewBox="0 0 240 150" role="img" [attr.aria-label]="ariaLabel()" [class.is-active]="active()" [attr.data-read]="read()">
      <defs>
        <clipPath [attr.id]="uid + '-v'"><circle [attr.cx]="victim.x" [attr.cy]="victim.y" r="22" /></clipPath>
        <clipPath [attr.id]="uid + '-j'"><circle cx="200" cy="64" r="14" /></clipPath>
        <clipPath [attr.id]="uid + '-t'"><circle cx="44" cy="30" r="14" /></clipPath>
      </defs>

      <!-- The ground the victim stands on. -->
      <g class="death-scene-part" [style.--i]="0">
        <ellipse class="death-scene-ground" cx="120" cy="124" rx="70" ry="12" />
      </g>

      <!-- Standing on their side: the midline, with the victim past it. -->
      @if (has('position')) {
        <g class="death-scene-part" [style.--i]="1">
          <path class="death-scene-midline" d="M50 4L72 146" />
          <text class="death-scene-caption" x="120" y="145" font-size="10" text-anchor="middle">their side</text>
        </g>
      }

      <!-- The victim: the champion in a ring the colour of the read, or a skull when the champion is unknown. -->
      <g class="death-scene-part" [style.--i]="2">
        <circle class="death-scene-tile" [attr.cx]="victim.x" [attr.cy]="victim.y" r="22" />
        @if (champion(); as c) {
          <image class="death-scene-img" [attr.href]="ui.championIconUrl(c)" [attr.x]="victim.x - 22" [attr.y]="victim.y - 22" width="44" height="44" [attr.clip-path]="'url(#' + uid + '-v)'" preserveAspectRatio="xMidYMid slice" />
        } @else {
          <g class="death-scene-glyph" transform="translate(103 71) scale(1.4)">
            <ng-container *ngTemplateOutlet="glyphTpl; context: { $implicit: shape('skull') }" />
          </g>
        }
        <circle [class]="'death-scene-ring is-read-' + read()" [attr.cx]="victim.x" [attr.cy]="victim.y" r="25" />
        @if (name(); as n) {
          <text class="death-scene-caption is-strong" x="120" y="126" font-size="10" text-anchor="middle">{{ n }}</text>
        }
      </g>

      <!-- No ward: a slashed ward in a bush at the left edge. -->
      @if (has('ward')) {
        <g class="death-scene-part death-scene-ward" [style.--i]="3">
          <path class="death-scene-bush" d="M8 96c0-9 9-15 21-15s21 5 21 14-8 14-20 15S8 105 8 96z" />
          <g class="death-scene-glyph" transform="translate(17 83) scale(1.1)">
            <ng-container *ngTemplateOutlet="glyphTpl; context: { $implicit: shape('ward-off') }" />
          </g>
          <text class="death-scene-caption" x="29" y="124" font-size="10" text-anchor="middle">no ward</text>
        </g>
      }

      <!-- A call: their jungler, already close, with an arrow pointing in. A champion only, never a name. -->
      @if (has('call')) {
        <g class="death-scene-part death-scene-their-jungler" [style.--i]="4">
          <circle class="death-scene-tile is-them" cx="44" cy="30" r="14" />
          @if (s.theirJungler?.champion; as tc) {
            <image class="death-scene-img" [attr.href]="ui.championIconUrl(tc)" x="30" y="16" width="28" height="28" [attr.clip-path]="'url(#' + uid + '-t)'" preserveAspectRatio="xMidYMid slice" />
          } @else {
            <g class="death-scene-glyph is-them" transform="translate(34.4 20.4) scale(0.8)">
              <ng-container *ngTemplateOutlet="glyphTpl; context: { $implicit: shape('jungler') }" />
            </g>
          }
          <path class="death-scene-arrow" d="M55 38.5L100 72.8" pathLength="100" />
          <path class="death-scene-arrow-head" d="M92.1 71.7L100.1 72.8L96.9 65.4" />
          <text class="death-scene-caption" x="44" y="56" font-size="9" text-anchor="middle">already close</text>
        </g>
      }

      <!-- An objective within the window: its glyph up top, glowing, ours or theirs. -->
      @if (s.objective; as o) {
        <g class="death-scene-part death-scene-objective" [style.--i]="5">
          <circle class="death-scene-glow" [class.is-theirs]="!o.ours" cx="120" cy="24" r="17" />
          <g class="death-scene-glyph death-scene-obj" [class.is-theirs]="!o.ours" transform="translate(108 12)">
            <ng-container *ngTemplateOutlet="glyphTpl; context: { $implicit: shape(objectiveGlyph()) }" />
          </g>
          <text class="death-scene-caption" x="120" y="50" font-size="10" text-anchor="middle">{{ o.ours ? 'taken' : 'theirs' }}</text>
        </g>
      }

      <!-- Executed: a tower looming behind the victim. The timeline's flag covers a monster too (a dragon on a steal), so the caption says both. -->
      @if (s.executed) {
        <g class="death-scene-part death-scene-executed" [style.--i]="6">
          <g class="death-scene-glyph death-scene-tower" transform="translate(150 20) scale(1.5)">
            <ng-container *ngTemplateOutlet="glyphTpl; context: { $implicit: shape('tower') }" />
          </g>
          <text class="death-scene-caption" x="172" y="13" font-size="9" text-anchor="middle">tower or monster</text>
        </g>
      }

      <!-- The ones who came in, fanned toward the victim. -->
      @if (hostiles().length) {
        <g class="death-scene-part death-scene-killers" [style.--i]="7">
          @for (h of hostiles(); track $index) {
            <path class="death-scene-hostile" d="M-7 -5L3 0L-7 5Z" [attr.transform]="'translate(' + h.x + ' ' + h.y + ') rotate(' + h.rotate + ')'" />
          }
        </g>
      }

      <!-- Allies within a screen, or alone. -->
      @if (allyLine(); as al) {
        <g class="death-scene-part death-scene-allies" [style.--i]="8">
          @for (i of allyDots(); track i) {
            <circle class="death-scene-ally" [attr.cx]="64 + i * 9" cy="104" r="3.2" />
          }
          <text class="death-scene-caption" x="78" y="118" font-size="10" text-anchor="middle">{{ al }}</text>
        </g>
      }

      <!-- The jungler a screen away: our jungler far right, a dashed line back to the victim. -->
      @if (has('jungle')) {
        <g class="death-scene-part death-scene-our-jungler" [style.--i]="9">
          <path class="death-scene-line" d="M140 104L187 76" />
          <circle class="death-scene-tile is-us" cx="200" cy="64" r="14" />
          @if (s.ourJungler?.champion; as jc) {
            <image class="death-scene-img" [attr.href]="ui.championIconUrl(jc)" x="186" y="50" width="28" height="28" [attr.clip-path]="'url(#' + uid + '-j)'" preserveAspectRatio="xMidYMid slice" />
          } @else {
            <g class="death-scene-glyph is-us" transform="translate(190.4 54.4) scale(0.8)">
              <ng-container *ngTemplateOutlet="glyphTpl; context: { $implicit: shape('jungler') }" />
            </g>
          }
          <text class="death-scene-caption" x="200" y="90" font-size="9" text-anchor="middle">a screen away</text>
          @if (junglerZone(); as z) {
            <text class="death-scene-caption is-muted" x="200" y="101" font-size="9" text-anchor="middle">{{ z }}</text>
          }
        </g>
      }

      <!-- A trade: crossed swords with how many of theirs fell. The scene carries no count of ours (a 2-for-2 gives two cards), so the caption claims only what it holds. -->
      @if (s.traded > 0) {
        <g class="death-scene-part death-scene-trade" [style.--i]="10">
          <g class="death-scene-glyph death-scene-swords" transform="translate(194 106) scale(1.15)">
            <ng-container *ngTemplateOutlet="glyphTpl; context: { $implicit: shape('swords') }" />
          </g>
          <text class="death-scene-caption" x="208" y="146" font-size="10" text-anchor="middle">{{ s.traded }} of theirs</text>
        </g>
      }
    </svg>

    <!-- One glyph's strokes, drawn inside whichever <g> placed and scaled it. -->
    <ng-template #glyphTpl let-g>
      @for (d of g.paths; track $index) {
        <svg:path [attr.d]="d" />
      }
      @for (c of g.circles ?? []; track $index) {
        <svg:circle [attr.cx]="c.cx" [attr.cy]="c.cy" [attr.r]="c.r" [class.is-fill]="!!c.fill" />
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet]
})
export class DeathSceneComponent {
  readonly scene = input.required<FilmDeathScene>();
  readonly read = input.required<DeathReadKind>();
  /** Ours: the champion who died. */
  readonly champion = input<string | undefined>(undefined);
  /** Ours only; theirs are never named. */
  readonly name = input<string | undefined>(undefined);
  /** The entrance runs when this turns true inside the current chapter. */
  readonly active = input<boolean>(false);
  /** The image's name for a screen reader: the caller passes the read line. */
  readonly label = input<string>('');

  protected readonly ui = inject(UiService);
  protected readonly victim = VICTIM;

  private static seq = 0;
  /** Clip paths need document-unique ids, and a map chapter draws one scene per death. */
  protected readonly uid = `death-scene-${++DeathSceneComponent.seq}`;

  protected readonly ariaLabel = computed(() => this.label() || READ_LABELS[this.read()].label);
  protected readonly hostiles = computed(() => hostileMarks(this.scene().killers));
  protected readonly objectiveGlyph = computed<FilmGlyph>(() => {
    const o = this.scene().objective;
    return o ? OBJECTIVE_GLYPHS[o.type] : 'flag';
  });
  protected readonly junglerZone = computed(() => {
    const z = this.scene().ourJungler?.zone;
    return z ? ZONE_LABELS[z] : '';
  });

  /** "2 near" when allies were within a screen; "alone" when none were and the death was avoidable; nothing when the timeline did not say. */
  protected readonly allyLine = computed(() => {
    const n = this.scene().alliesNear;
    if (n === undefined) return '';
    if (n > 0) return `${n} near`;
    return this.read() === 'avoidable' ? 'alone' : '';
  });
  protected readonly allyDots = computed(() => {
    const n = Math.min(MAX_ALLIES, Math.max(0, this.scene().alliesNear ?? 0));
    return Array.from({ length: n }, (_, i) => i);
  });

  protected has(tag: FilmDeathScene['could'][number]): boolean {
    return this.scene().could.includes(tag);
  }

  protected shape(name: FilmGlyph): FilmGlyphShape {
    return FILM_GLYPHS[name];
  }
}
