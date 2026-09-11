import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FilmGlyph } from '../../core/film-model';

/**
 * One hand-drawn glyph: outline paths on a 24×24 grid, drawn in currentColor
 * at 1.8 wide with round caps, so every glyph in the film is one family. A
 * circle is drawn filled when `fill` is set (a pupil, a toe, an eye dot), as
 * an outline otherwise.
 */
export interface FilmGlyphShape {
  paths: string[];
  circles?: { cx: number; cy: number; r: number; fill?: boolean }[];
}

/**
 * The film's own imagery (cut 4, 10 Sep 2026). Thirty glyphs, one per name
 * in `FilmGlyph`, drawn by hand so a death card, a tape beat and a draft swap
 * can say "no ward here", "the jungler was a screen away", "this bought the
 * dragon" without a Material icon that means something else in the rest of
 * the app. Each is legible at 1rem: nothing thinner than the stroke, nothing
 * closer than two units to the edge, and no two share a silhouette.
 */
export const FILM_GLYPHS: Record<FilmGlyph, FilmGlyphShape> = {
  // A totem stake with an eye: the ward that was there.
  ward: {
    paths: ['M9 4.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5V13l-3 8.5L9 13z', 'M9.3 8.5c1.2-1.7 4.2-1.7 5.4 0-1.2 1.7-4.2 1.7-5.4 0z', 'M9 13h6'],
    circles: [{ cx: 12, cy: 8.5, r: 0.9, fill: true }]
  },
  // The same stake with a slash through it: the ward that was not.
  'ward-off': {
    paths: ['M9 4.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5V13l-3 8.5L9 13z', 'M9.3 8.5c1.2-1.7 4.2-1.7 5.4 0-1.2 1.7-4.2 1.7-5.4 0z', 'M9 13h6', 'M4 20L20 4'],
    circles: [{ cx: 12, cy: 8.5, r: 0.9, fill: true }]
  },
  // A paw print: the jungler.
  jungler: {
    paths: ['M12 21c-3.2 0-5.5-1.6-5.5-4 0-1.6 1.2-2.7 2.4-3.6.9-.7 1.8-2.4 3.1-2.4s2.2 1.7 3.1 2.4c1.2.9 2.4 2 2.4 3.6 0 2.4-2.3 4-5.5 4z'],
    circles: [
      { cx: 5.5, cy: 10, r: 1.7 },
      { cx: 9.3, cy: 5.5, r: 1.7 },
      { cx: 14.7, cy: 5.5, r: 1.7 },
      { cx: 18.5, cy: 10, r: 1.7 }
    ]
  },
  // A small paw, a dashed trail leading away, and a two-headed distance arrow under it: the jungler a screen away.
  'jungler-far': {
    paths: [
      'M6.5 11.5c-1.9 0-3.3-1-3.3-2.4 0-1 .7-1.6 1.4-2.2.6-.4 1.1-1.4 1.9-1.4s1.3 1 1.9 1.4c.7.6 1.4 1.2 1.4 2.2 0 1.4-1.4 2.4-3.3 2.4z',
      'M11 12.5l2 1.3',
      'M14.8 14.8l2 1',
      'M18.5 16.8l1.8.6',
      'M4 21h16',
      'M6 18.5L3.5 21 6 23.5',
      'M18 18.5l2.5 2.5-2.5 2.5'
    ],
    circles: [
      { cx: 2.7, cy: 5.1, r: 0.9, fill: true },
      { cx: 5, cy: 2.5, r: 0.9, fill: true },
      { cx: 8, cy: 2.5, r: 0.9, fill: true },
      { cx: 10.3, cy: 5.1, r: 0.9, fill: true }
    ]
  },
  // A call horn with two sound lines: the call that would have pulled them out.
  horn: {
    paths: ['M4 9.5v5h3.5l8.5 5V4.5L7.5 9.5z', 'M6 14.5l1 5h2.5l-.8-5', 'M18.5 9c1.7 1 1.7 5 0 6', 'M20.5 6.5c2.8 2.3 2.8 8.7 0 11']
  },
  // Two footprints, one ahead of the other: standing somewhere else.
  footsteps: {
    paths: ['M8 11.5c-1.8 0-3 2-3 4.2S6.2 20 8 20s3-2 3-4.3-1.2-4.2-3-4.2z', 'M16 8c-1.8 0-3 2-3 4.2s1.2 4.3 3 4.3 3-2 3-4.3S17.8 8 16 8z'],
    circles: [
      { cx: 8, cy: 8.3, r: 1.6 },
      { cx: 16, cy: 4.3, r: 1.6 }
    ]
  },
  // A turret: battlement, tapered body, an arched door.
  tower: {
    paths: ['M6 9V5h3v2h2V5h2v2h2V5h3v4', 'M6 9h12', 'M7 9l1 12h8l1-12', 'M4 21h16', 'M10.5 21v-3.5a1.5 1.5 0 0 1 3 0V21']
  },
  // A dragon's head in profile, snout to the left, jaw open, two horns swept back.
  dragon: {
    paths: ['M3 11l6-2.5 3-4.5c2.5-1.5 5.5-1 7 1.5l2 3.5-3 1.5-.5 3.5-3.5 1.5c-2.5.5-5 0-7-1.5L6 15z', 'M13 4.5l1-3 2 2.5', 'M16.5 5l2-3 1.5 3', 'M3 11l3.5 2.5 4-1'],
    circles: [
      { cx: 13.5, cy: 8.5, r: 1, fill: true },
      { cx: 5.5, cy: 10.3, r: 0.6, fill: true }
    ]
  },
  // A worm's head seen from the front: a round maw, horns curling out, spikes at the sides.
  baron: {
    paths: ['M12 21.5c-4.6 0-7.5-3-7.5-7 0-3.5 2-6.5 4.5-8.5h6c2.5 2 4.5 5 4.5 8.5 0 4-2.9 7-7.5 7z', 'M9.5 6.5c-1-2-3-3-5-2.5', 'M14.5 6.5c1-2 3-3 5-2.5', 'M4.5 13l-2.5-1', 'M19.5 13l2.5-1'],
    circles: [
      { cx: 12, cy: 15, r: 3.4 },
      { cx: 12, cy: 15, r: 1.2, fill: true },
      { cx: 9.5, cy: 10, r: 0.9, fill: true },
      { cx: 14.5, cy: 10, r: 0.9, fill: true }
    ]
  },
  // One eye under a spiked shell, legs below: the herald.
  herald: {
    paths: ['M3 14a9 9 0 0 1 18 0', 'M3 14h18', 'M7 11c1.5-2.5 8.5-2.5 10 0-1.5 2.5-8.5 2.5-10 0z', 'M12 5V2', 'M7.5 6.5l-1.5-3', 'M16.5 6.5l1.5-3', 'M6 14l-1.5 5', 'M12 14v5', 'M18 14l1.5 5'],
    circles: [{ cx: 12, cy: 11, r: 1.2, fill: true }]
  },
  // Three grubs, one above two: fat little ovals, an eye at the front and a fold behind the head.
  grubs: {
    paths: [
      'M2.5 17.5c0-1.4 1.8-2.6 4-2.6s4 1.2 4 2.6-1.8 2.6-4 2.6-4-1.2-4-2.6z',
      'M8 9c0-1.4 1.8-2.6 4-2.6s4 1.2 4 2.6-1.8 2.6-4 2.6S8 10.4 8 9z',
      'M13.5 17.5c0-1.4 1.8-2.6 4-2.6s4 1.2 4 2.6-1.8 2.6-4 2.6-4-1.2-4-2.6z',
      'M4.6 16.3v2.4',
      'M10.1 7.8v2.4',
      'M15.6 16.3v2.4'
    ],
    circles: [
      { cx: 9, cy: 17, r: 0.7, fill: true },
      { cx: 14.5, cy: 8.5, r: 0.7, fill: true },
      { cx: 20, cy: 17, r: 0.7, fill: true }
    ]
  },
  // A crowned beast: three points over a broad face with tusks.
  atakhan: {
    paths: ['M5.5 10L4 3.5l4 3L12 2l4 4.5 4-3L18.5 10z', 'M5.5 10l1.2 7.5L12 22l5.3-4.5L18.5 10z', 'M8.5 16.5L7 20', 'M15.5 16.5L17 20'],
    circles: [
      { cx: 9.3, cy: 13.5, r: 0.9, fill: true },
      { cx: 14.7, cy: 13.5, r: 0.9, fill: true }
    ]
  },
  // Two swords crossed, guards and grips at the bottom corners.
  swords: {
    paths: ['M4 4l14 14', 'M14 19l5-5', 'M18 18l2 2', 'M20 4L6 18', 'M5 14l5 5', 'M6 18l-2 2']
  },
  skull: {
    paths: ['M12 3c-4.7 0-8 3.3-8 7.6 0 2.4 1 4.3 2.5 5.6V20h11v-3.8c1.5-1.3 2.5-3.2 2.5-5.6C20 6.3 16.7 3 12 3z', 'M12 13.5l-1.2 2.2h2.4z', 'M10 20v-2.5', 'M14 20v-2.5'],
    circles: [
      { cx: 9, cy: 11, r: 1.6 },
      { cx: 15, cy: 11, r: 1.6 }
    ]
  },
  // A shield with a centre crease: peel.
  shield: {
    paths: ['M12 2.5l8 3v6c0 4.8-3.4 8.1-8 10-4.6-1.9-8-5.2-8-10v-6z', 'M12 2.5v19']
  },
  // A battlement over courses of brick: frontline.
  wall: {
    paths: ['M3 9V5h4v2.5h3.5V5h3v2.5H17V5h4v4', 'M3 9h18', 'M3 9v12', 'M21 9v12', 'M3 21h18', 'M3 13h18', 'M3 17h18', 'M9 9v4', 'M15 9v4', 'M6 13v4', 'M12 13v4', 'M18 13v4', 'M9 17v4', 'M15 17v4']
  },
  // A fist seen from the front, thumb across: engage.
  fist: {
    paths: ['M4 12.5a2 2 0 0 1 4 0', 'M8 11.5a2 2 0 0 1 4 0', 'M12 11.5a2 2 0 0 1 4 0', 'M16 12.5a2 2 0 0 1 4 0', 'M4 12.5v3.5c0 2.8 2.2 5 5 5h6c2.8 0 5-2.2 5-5v-3.5', 'M8 11.5v3', 'M12 11.5v3', 'M16 12.5v2.5', 'M4 15.5h8.5a1.8 1.8 0 0 1 0 3.6H9']
  },
  // A coin with a gold mark on it: what a death bought.
  coin: {
    paths: ['M12 6.5v2', 'M12 15.5v2', 'M9 15c.6 1 1.7 1.6 3 1.6 1.8 0 3-1 3-2.2 0-1.6-1.5-2-3-2.4s-3-.8-3-2.4c0-1.2 1.2-2.2 3-2.2 1.3 0 2.4.6 3 1.6'],
    circles: [{ cx: 12, cy: 12, r: 8.5 }]
  },
  // Two arrows chasing each other round a circle: a swap in the draft.
  swap: {
    paths: ['M5 12a7 7 0 0 1 7-7h4.5', 'M14 2.5L16.5 5 14 7.5', 'M19 12a7 7 0 0 1-7 7H7.5', 'M10 21.5L7.5 19 10 16.5']
  },
  // A flag on a pole, the cloth in a wave.
  flag: {
    paths: ['M5 21.5V3', 'M5 4c3-1.6 6 1.6 9 0s4-1.2 6.5 0v9c-2.5-1.2-3.5-1.6-6.5 0s-6-1.6-9 0z']
  },
  eye: {
    paths: ['M2.5 12c2.5-4.7 6-7 9.5-7s7 2.3 9.5 7c-2.5 4.7-6 7-9.5 7S5 16.7 2.5 12z'],
    circles: [{ cx: 12, cy: 12, r: 3 }]
  },
  // A drop with a highlight.
  blood: {
    paths: ['M12 2.5c3.5 5 7 8.7 7 12.7a7 7 0 0 1-14 0c0-4 3.5-7.7 7-12.7z', 'M8.5 15.5a3.5 3.5 0 0 0 2.5 3.3']
  },
  bolt: {
    paths: ['M13 2L5 13.5h6L10 22l9-12.5h-6z']
  },
  // An arrow in flight: a solid head, fletching at the tail.
  poke: {
    paths: ['M4 20L17 7', 'M18.5 5.5l-1.2 5.7-4.5-4.5z', 'M6.5 17.5l-3.5-1', 'M6.5 17.5l1 3.5']
  },
  // A heart with a plus in it.
  sustain: {
    paths: ['M12 20.5l-6.8-6.5C3 11.8 3 8 5.5 6.2c2.1-1.6 4.9-1.2 6.5 1 1.6-2.2 4.4-2.6 6.5-1 2.5 1.8 2.5 5.6.3 7.8z', 'M12 9.5v6', 'M9 12.5h6']
  },
  // One path becoming two: the split push.
  split: {
    paths: ['M12 21.5V13', 'M12 13c0-5-5-5.5-7-9', 'M12 13c0-5 5-5.5 7-9', 'M3.5 7.5L5 4l3.7.3', 'M20.5 7.5L19 4l-3.7.3']
  },
  // A curling crest over the swell: waveclear.
  wave: {
    paths: ['M3 18.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0', 'M4 13.5c1-4.3 4-6.8 8-6.8 3.2 0 5.8 1.7 7.2 4.3-1.6-1-3.2-1.2-4.7-.6']
  },
  // A fishing hook, eye at the top, barb at the point: the pick.
  hook: {
    paths: ['M15 5v7.5a5 5 0 0 1-10 0V8', 'M5 8l2.2 2.3'],
    circles: [{ cx: 15, cy: 3.5, r: 1.3 }]
  },
  // Three lines of wind, two curling: disengage.
  wind: {
    paths: ['M3 8h11a2.5 2.5 0 1 0-2.4-3', 'M3 13h15a2.5 2.5 0 1 1-2.4 3', 'M3 18h8']
  },
  // Three lanes running corner to corner: the map read as lanes rather than as ground.
  lane: {
    paths: ['M3 21L21 3', 'M3 13.5h7.5', 'M13.5 10.5H21', 'M10.5 3v7.5', 'M13.5 13.5V21']
  },
  // A clock: tempo, which is a question about when and not about where.
  clock: {
    paths: ['M12 7.5V12l3 2'],
    circles: [{ cx: 12, cy: 12, r: 8.5 }]
  },
  // A folded map: the whole board, which is what macro is about.
  map: {
    paths: ['M3 6.5l6-2.5 6 2.5 6-2.5v15l-6 2.5-6-2.5-6 2.5z', 'M9 4v15', 'M15 6.5v15']
  },
  check: {
    paths: ['M4 12.5l5 5L20 6.5']
  }
};

/** What each glyph says, for a tooltip beside one that stands alone (a pin's badge, a beat's mark). */
export const GLYPH_TIPS: Record<FilmGlyph, string> = {
  ward: 'A ward was down',
  'ward-off': 'No ward nearby',
  jungler: 'Our jungler',
  'jungler-far': 'Our jungler a screen away',
  horn: 'A call would have pulled them out',
  footsteps: 'Standing elsewhere would have done it',
  tower: 'A tower or a monster',
  dragon: 'A dragon',
  baron: 'Baron',
  herald: 'The herald',
  grubs: 'Grubs',
  atakhan: 'Atakhan',
  swords: 'Traded in the same fight',
  skull: 'Avoidable',
  shield: 'Peel',
  wall: 'Frontline',
  fist: 'Engage',
  coin: 'Bought an objective',
  swap: 'A swap in the draft',
  flag: 'An objective',
  eye: 'Vision',
  blood: 'First blood',
  bolt: 'Damage',
  poke: 'Poke',
  sustain: 'Sustain',
  split: 'Split push',
  wave: 'Wave clear',
  hook: 'Pick',
  wind: 'Disengage',
  lane: 'The lanes',
  clock: 'Tempo',
  map: 'The map',
  check: 'Clean'
};

/**
 * `<app-film-glyph name="ward-off" />`: one glyph as an inline SVG the size of
 * the text around it (`size` scales that, in em). Decorative by default, so a
 * caption beside it carries the meaning; given a `label` it becomes an image
 * with that name for a reader who cannot see it. The paths and circles are
 * bound one by one from `FILM_GLYPHS`, never as markup.
 */
@Component({
  selector: 'app-film-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="film-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      [style.--g]="size()"
      [attr.data-glyph]="name()"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() || null"
      [attr.aria-hidden]="label() ? null : 'true'"
    >
      @for (d of shape().paths; track $index) {
        <path [attr.d]="d" />
      }
      @for (c of shape().circles ?? []; track $index) {
        <circle [attr.cx]="c.cx" [attr.cy]="c.cy" [attr.r]="c.r" [attr.fill]="c.fill ? 'currentColor' : null" [attr.stroke]="c.fill ? 'none' : null" />
      }
    </svg>
  `
})
export class FilmGlyphComponent {
  readonly name = input.required<FilmGlyph>();
  /** In em of the surrounding text; 1 sits on the line like a capital. */
  readonly size = input<number>(1);
  /** The image's name for a screen reader; without one the glyph is decoration and the text beside it does the talking. */
  readonly label = input<string>('');

  protected readonly shape = computed<FilmGlyphShape>(() => FILM_GLYPHS[this.name()] ?? FILM_GLYPHS.flag);
}
