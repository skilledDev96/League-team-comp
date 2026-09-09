import { Component, input, output } from '@angular/core';
import { ReviewTheme } from '../../models/team.models';

/**
 * The shell every chapter of the film stands in (9 Sep 2026): the kicker in
 * small caps with the chapter's place in the run, the body, a reveal slot
 * under it for whatever lands after a call, and the Next and Back pills. The
 * pills only show on a wide screen; on a phone the deck scrolls and the dot
 * rail follows.
 */
@Component({
  selector: 'app-film-frame',
  template: `
    <article class="film-frame">
      <p class="film-kicker"><span class="film-kicker-n">{{ index() + 1 }} / {{ count() }}</span>{{ kicker() }}</p>
      <div class="film-frame-body"><ng-content /></div>
      <div class="film-frame-reveal"><ng-content select="[reveal]" /></div>
      <div class="film-frame-nav">
        @if (index() > 0) {
          <button type="button" class="view-btn" (click)="back.emit()"><span class="material-symbols-rounded" aria-hidden="true">arrow_upward</span> Back</button>
        }
        @if (index() < count() - 1) {
          <button type="button" class="view-btn active" (click)="next.emit()">Next <span class="material-symbols-rounded" aria-hidden="true">arrow_downward</span></button>
        }
      </div>
    </article>
  `
})
export class FilmFrameComponent {
  readonly kicker = input<string>('');
  readonly index = input<number>(0);
  readonly count = input<number>(1);
  readonly next = output<void>();
  readonly back = output<void>();
}

/** The Material Symbol for each review theme; the same set the review panel draws. */
export const THEME_ICONS: Record<ReviewTheme, string> = {
  draft: 'swords',
  lanes: 'alt_route',
  fights: 'local_fire_department',
  objectives: 'flag',
  vision: 'visibility',
  tempo: 'schedule',
  macro: 'map'
};

export function themeIcon(theme: string | undefined): string {
  return (theme && THEME_ICONS[theme as ReviewTheme]) || 'label';
}

export function themeLabel(theme: string | undefined): string {
  return theme ? theme[0].toUpperCase() + theme.slice(1) : '';
}
