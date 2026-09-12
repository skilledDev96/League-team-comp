import { Component, computed, inject, input } from '@angular/core';
import { Achievement } from '../../../core/achievements';
import { InViewDirective } from '../../../shared/in-view.directive';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { UiService } from '../../../services/ui.service';

/**
 * The trophy cabinet, lowest on the page (13 Sep 2026, the lead: "trophy cabinet can be lower on the page
 * as this is not important for now but will be cool later on"). Every trophy is read off games and series
 * the app already holds; an earned one is lit with what earned it in its tip, a locked one is greyed with
 * how far along it is. Trophies entered by hand arrive with Phase 2.
 */
@Component({
  selector: 'app-home-trophies',
  imports: [InViewDirective, TooltipDirective],
  template: `
    <section class="card home-tile home-trophies" appInView aria-labelledby="home-trophies-title">
      <header class="home-card-head">
        <h2 id="home-trophies-title"><span class="material-symbols-rounded" aria-hidden="true">trophy</span> Trophy cabinet</h2>
        <span class="home-card-scope">{{ earned() }} of {{ trophies().length }} earned</span>
      </header>
      <ul class="home-trophy-grid">
        @for (t of trophies(); track t.id) {
          <li class="home-trophy" [class.is-earned]="t.unlocked" [class.is-season]="t.thisSeason" tabindex="0" [appTip]="tip(t)">
            <span class="home-trophy-icon material-symbols-rounded" aria-hidden="true">{{ t.unlocked ? t.icon : 'lock' }}</span>
            <b class="home-trophy-title">{{ t.title }}</b>
            @if (t.progress && !t.unlocked) {
              <span class="home-trophy-progress" [style.--home-share]="share(t)" aria-hidden="true"><span></span></span>
              <small>{{ t.progress.have }} / {{ t.progress.need }}</small>
            } @else if (t.unlocked && t.earnedAt) {
              <small>{{ day(t.earnedAt) }}</small>
            } @else if (t.unlocked) {
              <small>Earned</small>
            } @else {
              <small>Locked</small>
            }
            <span class="visually-hidden">{{ tip(t) }}</span>
          </li>
        }
      </ul>
    </section>
  `
})
export class HomeTrophiesComponent {
  readonly trophies = input.required<readonly Achievement[]>();

  private readonly ui = inject(UiService);

  protected readonly earned = computed(() => this.trophies().filter((t) => t.unlocked).length);

  protected share(t: Achievement): string {
    return t.progress ? String(Math.min(1, t.progress.have / t.progress.need)) : '0';
  }

  protected day(at: number): string {
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected tip(t: Achievement): string {
    if (!t.unlocked) {
      return t.progress ? `${t.blurb} ${t.progress.have} of ${t.progress.need} so far.` : `${t.blurb} Not yet.`;
    }
    const who = t.by ? [t.by, t.champion ? `on ${this.ui.championName(t.champion)}` : ''].filter(Boolean).join(' ') : '';
    const against = t.opponent ? `${who ? 'against' : 'Against'} ${t.opponent}` : '';
    const how = [who, against].filter(Boolean).join(', ');
    return [t.blurb, how ? `${how}.` : '', t.thisSeason ? 'Earned this season.' : ''].filter(Boolean).join(' ');
  }
}
