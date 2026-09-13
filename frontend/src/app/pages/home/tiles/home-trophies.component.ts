import { Component, computed, inject, input } from '@angular/core';
import { Achievement } from '../../../core/achievements';
import { HomeHandTrophy } from '../../../core/home-model';
import { InfoTipComponent } from '../../../shared/info-tip.component';
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
  imports: [InfoTipComponent, InViewDirective, TooltipDirective],
  template: `
    <section class="card home-tile home-trophies" appInView aria-labelledby="home-trophies-title">
      <header class="home-card-head">
        <h2 id="home-trophies-title"><span class="material-symbols-rounded" aria-hidden="true">trophy</span> Trophy cabinet
          <app-info-tip text="Nobody awards these. Each one is read off the games and series the app already holds — a series won, a win under 25 minutes, a soul, a streak and so on — and lights up with the game that first earned it; hover one for its rule. The medals at the top are the ones entered by hand on Admin › Trophies, for what the games cannot show: a final placing, a cup." label="How the trophies are decided" /></h2>
        <span class="home-card-scope">@if (won().length) { {{ won().length }} won · }{{ earned() }} of {{ trophies().length }} earned</span>
      </header>
      @if (won().length) {
        <ul class="home-won" aria-label="Trophies won">
          @for (w of won(); track w.id) {
            <li class="home-won-card" [class]="medalClass(w)" tabindex="0" [appTip]="wonTip(w)">
              @if (w.champion) {
                <img class="home-won-art" [src]="ui.championArtUrl(w.champion)" (error)="ui.artFallback($event, w.champion)" alt="" loading="lazy" />
              }
              <span class="home-won-shade" aria-hidden="true"></span>
              <span class="home-won-medal" aria-hidden="true">
                @if (w.placement) { {{ ordinal(w.placement) }} } @else { <span class="material-symbols-rounded">trophy</span> }
              </span>
              <span class="home-won-text">
                <b>{{ w.title }}</b>
                <small>{{ wonLine(w) }}</small>
              </span>
              <span class="visually-hidden">{{ wonTip(w) }}</span>
            </li>
          }
        </ul>
      }
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
  /** Trophies entered by hand, which stand first. */
  readonly won = input<readonly HomeHandTrophy[]>([]);

  protected readonly ui = inject(UiService);

  protected readonly earned = computed(() => this.trophies().filter((t) => t.unlocked).length);

  protected share(t: Achievement): string {
    return t.progress ? String(Math.min(1, t.progress.have / t.progress.need)) : '0';
  }

  protected day(at: number): string {
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected ordinal(place: number): string {
    return place === 5 ? 'Top 8' : `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'}`;
  }

  protected medalClass(w: HomeHandTrophy): string {
    return w.placement === 1 ? 'is-gold' : w.placement === 2 ? 'is-silver' : w.placement === 3 ? 'is-bronze' : 'is-cup';
  }

  protected wonLine(w: HomeHandTrophy): string {
    return [w.where, w.at ? this.day(w.at) : ''].filter(Boolean).join(' · ');
  }

  protected wonTip(w: HomeHandTrophy): string {
    const place = w.placement ? `${w.placement === 5 ? 'Top 8' : this.ordinal(w.placement) + ' place'}` : '';
    return [w.title, place, w.where, w.at ? this.day(w.at) : '', w.note].filter(Boolean).join(' · ');
  }

  protected tip(t: Achievement): string {
    const counted = t.coverage && t.coverage.read < t.coverage.of ? ` Counted over ${t.coverage.read} of ${t.coverage.of} Riot games so far.` : '';
    if (!t.unlocked) {
      return t.progress ? `${t.blurb} ${t.progress.have} of ${t.progress.need} so far.` : `${t.blurb} Not yet.${counted}`;
    }
    const who = t.by ? [t.by, t.champion ? `on ${this.ui.championName(t.champion)}` : ''].filter(Boolean).join(' ') : '';
    const against = t.opponent ? `${who ? 'against' : 'Against'} ${t.opponent}` : '';
    const how = [who, against].filter(Boolean).join(', ');
    return [t.blurb, how ? `${how}.` : '', t.thisSeason ? 'Earned this season.' : ''].filter(Boolean).join(' ');
  }
}
