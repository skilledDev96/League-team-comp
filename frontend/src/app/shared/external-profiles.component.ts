import { Component, computed, inject, input } from '@angular/core';
import { SummonerProfile } from '../models/team.models';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-external-profiles',
  template: `
    <details class="link-dropdown external-profiles">
      <summary>{{ label() }}</summary>
      <div class="links compact">
        <a class="view-btn is-compact" [href]="opggUrl()" target="_blank" rel="noopener noreferrer">OP.GG <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>
        @if (mobalyticsUrl(); as moba) {
          <a class="view-btn is-compact" [href]="moba" target="_blank" rel="noopener noreferrer">Mobalytics <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>
        }
      </div>
    </details>
  `
})
export class ExternalProfilesComponent {
  private readonly ui = inject(UiService);

  readonly name = input.required<string>();
  readonly profile = input<SummonerProfile | undefined>(undefined);
  readonly label = input<string>('External profiles');

  protected readonly opggUrl = computed(() => this.ui.summonerSearchUrl(this.name(), this.profile()));
  protected readonly mobalyticsUrl = computed(() => this.ui.summonerMobalyticsUrl(this.profile()));
}
