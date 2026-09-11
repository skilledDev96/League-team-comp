import { Component, computed, input } from '@angular/core';
import { askOf, evidenceChips, THEME_GLYPHS, THEME_WORDS } from '../../core/review-view';
import { ReviewPoint } from '../../models/team.models';
import { FilmGlyphComponent } from '../film/film-glyph.component';
import { InfoTipComponent } from '../info-tip.component';
import { TooltipDirective } from '../tooltip.directive';

/**
 * One point of a review, as figures rather than as a paragraph (12 Sep 2026).
 *
 * The lead's complaint was measured before it was answered: the panel rendered ~350 words of prose
 * while every `evidence` string the review stored — the jargon-native part, `Nautilus 0/9/15 · 20 cs
 * · level 10 vs their 12` — was never rendered at all. `evidenceChips` has existed at
 * `core/review-view.ts` since the panel was written and had no caller. This is the caller.
 *
 * So a point draws as **glyph + chips + ⓘ**: the theme as one of the film's own glyphs, the
 * figures as chips a reader scans rather than reads, and the coach's whole sentence one hover away.
 * A forty-word sentence becomes three chips and loses nothing, because the sentence is still there.
 *
 * Two honest fallbacks, both of which a real stored review hits:
 *
 * - **A point whose evidence will not split.** `evidenceChips` returns the whole string as a single
 *   part when it finds no `·` and no listing comma, and one chip holding a clause is not a figure —
 *   it is the paragraph again, in a box. Under two chips the line shows the point as a short ask
 *   instead and the tip carries both the sentence and the evidence.
 * - **A point with no theme.** Optional in the type since the field arrived on version 2, so eleven
 *   stored reviews predate it. No glyph is drawn rather than a blank square.
 *
 * The leading slot is projected, so the same component draws a team point and a player's ask: the
 * panel puts the player's mark and name in it and this file never learns what a player is.
 */
@Component({
  selector: 'app-review-point',
  imports: [FilmGlyphComponent, InfoTipComponent, TooltipDirective],
  template: `
    <p class="game-review-line-one review-point" [class.is-warn]="tone() === 'warn'" [class.is-ok]="tone() === 'ok'" [class.is-person]="tone() === 'person'">
      <ng-content />
      @if (glyph(); as g) { <app-film-glyph class="review-point-glyph" [name]="g" [appTip]="themeWord()" /> }
      @if (label()) { <b>{{ label() }}</b> }
      @if (minute() !== null) { <span class="review-minute">{{ minute() }} min</span> }
      @if (chips().length) {
        <span class="review-point-chips">
          @for (c of chips(); track $index) { <span class="evidence-chip">{{ c }}</span> }
        </span>
      } @else {
        <span class="review-point-said">{{ said() }}</span>
      }
      <app-info-tip [text]="tip()" [label]="'The whole point' + (label() ? ': ' + label() : '')" />
    </p>
  `
})
export class ReviewPointComponent {
  readonly point = input.required<ReviewPoint>();
  /** The border and the glyph's colour: a thing to work on, a thing that worked, or a person's ask. */
  readonly tone = input<'warn' | 'ok' | 'person' | 'plain'>('plain');
  /** A heading on the line itself, for the one point that carries one; the rest stand under a group label. */
  readonly label = input<string>('');
  /** Whether the review's minutes are real; a totals-only review has none to show. */
  readonly timed = input<boolean>(false);

  protected readonly chips = computed(() => {
    const parts = evidenceChips(this.point().evidence ?? '');
    // One part means the split found nothing to split on, so the "chip" is the whole clause.
    return parts.length >= 2 ? parts : [];
  });

  protected readonly glyph = computed(() => {
    const theme = this.point().theme;
    return theme ? (THEME_GLYPHS[theme] ?? null) : null;
  });

  protected readonly themeWord = computed(() => {
    const theme = this.point().theme;
    return theme ? (THEME_WORDS[theme] ?? '') : '';
  });

  /**
   * The clock, only when the chips are not already carrying one. Every evidence string a real
   * review has written leads with `33:05` or `22:44`, so printing the minute beside them would be
   * the same second said twice in two formats.
   */
  protected readonly minute = computed(() => {
    const m = this.point().minute;
    if (m === null || m === undefined || !this.timed()) return null;
    return this.chips().some((c) => /\d{1,2}:\d{2}/.test(c)) ? null : m;
  });

  /** The short form of the sentence, for a point whose evidence would not chip. */
  protected readonly said = computed(() => askOf(this.point().text, 120));

  /** The whole of it: the sentence always, and the evidence too when the line is not already showing it. */
  protected readonly tip = computed(() => {
    const p = this.point();
    const evidence = (p.evidence ?? '').trim();
    return this.chips().length || !evidence ? p.text : `${p.text}\n\n${evidence}`;
  });
}
