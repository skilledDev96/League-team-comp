import { Component, computed, inject, input } from '@angular/core';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-champion-chip',
  template: `
    <a class="champ-chip" [href]="buildUrl()" target="_blank" rel="noopener noreferrer">
      <img class="champ-icon" [src]="iconUrl()" [alt]="champion() + ' icon'" loading="lazy" />
      <span>{{ label() || champion() }}</span>
    </a>
  `
})
export class ChampionChipComponent {
  private readonly ui = inject(UiService);

  readonly champion = input.required<string>();
  readonly label = input<string>('');

  protected readonly iconUrl = computed(() => this.ui.championIconUrl(this.champion()));
  protected readonly buildUrl = computed(() => this.ui.championBuildUrl(this.champion()));
}
