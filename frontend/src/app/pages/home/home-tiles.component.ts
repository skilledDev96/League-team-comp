import { Component, input } from '@angular/core';
import { HomeModel } from '../../core/home-model';
import { HomeAdviceComponent } from './tiles/home-advice.component';
import { HomeCompMonthComponent } from './tiles/home-comp-month.component';
import { HomeLineupComponent } from './tiles/home-lineup.component';
import { HomeObjectivesComponent } from './tiles/home-objectives.component';
import { HomePodiumComponent } from './tiles/home-podium.component';
import { HomeRecordComponent } from './tiles/home-record.component';
import { HomeRecordsComponent } from './tiles/home-records.component';
import { HomeTrendComponent } from './tiles/home-trend.component';
import { HomeTrophiesComponent } from './tiles/home-trophies.component';

/**
 * The bento under the spotlight (13 Sep 2026, design B's "Team HQ"), loaded as its own chunk once it
 * nears the screen: the podium, the record and the form; the comp of the month beside the records to
 * beat; what we do well and what to work on; the five; objective control; and the trophy cabinet last,
 * because it matters later rather than now.
 */
@Component({
  selector: 'app-home-tiles',
  imports: [
    HomeAdviceComponent,
    HomeCompMonthComponent,
    HomeLineupComponent,
    HomeObjectivesComponent,
    HomePodiumComponent,
    HomeRecordComponent,
    HomeRecordsComponent,
    HomeTrendComponent,
    HomeTrophiesComponent
  ],
  template: `
    @let h = home();
    <div class="home-bento">
      <app-home-podium class="home-cell home-cell-podium" [podium]="h.race.podium" [scope]="scope()" />
      <app-home-record class="home-cell home-cell-record" [record]="h.record" [scopeLabel]="h.season.label" />
      <app-home-trend class="home-cell home-cell-trend" [trend]="h.trend" />
      <app-home-comp-month class="home-cell home-cell-comp" [compMonth]="h.compMonth" />
      <app-home-records class="home-cell home-cell-records" [records]="h.records" [scopeLabel]="h.season.label" />
      <app-home-advice class="home-cell home-cell-advice" [advice]="h.advice" />
      <app-home-lineup class="home-cell home-cell-lineup" [lineup]="h.lineup" [scope]="scope()" />
      <app-home-objectives class="home-cell home-cell-objectives" [objectives]="h.objectives" [scope]="scope()" />
      <app-home-trophies class="home-cell home-cell-trophies" [trophies]="h.trophies" />
    </div>
  `
})
export class HomeTilesComponent {
  readonly home = input.required<HomeModel>();
  readonly scope = input.required<string>();
}
