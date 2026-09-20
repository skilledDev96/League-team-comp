import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChampionDataService, ChampionSkin } from '../../../services/champion-data.service';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { RouterLink } from '@angular/router';
import { AdminContextService } from '../admin-context.service';

/** Team-wide settings. */
@Component({
  selector: 'app-admin-settings',
  imports: [NgModelNameDirective, FormsModule, RouterLink],
  templateUrl: './settings.component.html'
})
export class AdminSettingsComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  private readonly champions = inject(ChampionDataService);
  protected readonly championNames = computed(() => this.champions.champions().map((c) => c.name).sort((a, b) => a.localeCompare(b)));
  /**
   * The preview's splash would not load. Data Dragon lists skins Riot does not publish a splash for — Miss
   * Fortune's skin 10 answers 403 while 2 and 15 are served — so this is about the picture, not the skin.
   */
  protected readonly previewFailed = signal(false);

  /** Skin numbers whose splash has failed here, so the list can say so rather than let it be tried twice. */
  protected readonly noSplash = signal<ReadonlySet<number>>(new Set());

  /**
   * The champion's own skins (21 Sep 2026). Riot's numbers have gaps, so typing one was guessing: the list names
   * them instead. Loaded when the champion changes; an empty list (offline, or a name Data Dragon does not know)
   * leaves the number box, which still works.
   */
  protected readonly skins = signal<ChampionSkin[]>([]);
  private loadedFor = '';

  constructor() {
    effect(() => {
      const champion = this.ctx.bannerChampion().trim();
      if (champion === this.loadedFor) return;
      this.loadedFor = champion;
      this.skins.set([]);
      this.noSplash.set(new Set());
      if (!champion) return;
      void this.champions.skinsOf(champion).then((skins) => {
        if (this.loadedFor === champion) this.skins.set(skins);
      });
    });
  }

  /** The skin the banner is on, as the list knows it — or null when the number is not one of them. */
  protected readonly chosenSkin = computed(() => this.skins().find((s) => s.num === this.ctx.bannerSkin()) ?? null);

  protected pickSkin(value: string): void {
    const num = Number(value);
    if (Number.isFinite(num)) this.ctx.setBannerSkin(num);
  }

  /** The splash 404'd or was refused: remember which skin, so the list marks it. */
  protected splashFailed(): void {
    this.previewFailed.set(true);
    const num = this.ctx.bannerSkin();
    if (this.noSplash().has(num)) return;
    this.noSplash.set(new Set([...this.noSplash(), num]));
  }

  /** How a skin reads in the list: its name, and whether its splash has refused to load here. */
  protected skinLabel(skin: ChampionSkin): string {
    return this.noSplash().has(skin.num) ? `${skin.name} — no splash` : skin.name;
  }
}
