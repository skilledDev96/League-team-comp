import { Component, computed, inject, input, signal } from '@angular/core';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-player-avatar',
  template: `
    <span class="avatar" [class.has-image]="loaded()">
      <span class="avatar-fallback">{{ ui.avatarInitial(name()) }}</span>
      @if (src()) {
        <img class="avatar-img" [src]="src()" [alt]="name() + ' summoner icon'"
             loading="eager" (load)="loaded.set(true)" />
      }
      @if (badge()) {
        <span class="avatar-role">{{ badge() }}</span>
      }
    </span>
  `
})
export class PlayerAvatarComponent {
  protected readonly ui = inject(UiService);

  readonly name = input<string>('');
  readonly icon = input<string | undefined>(undefined);
  readonly role = input<string | undefined>(undefined);

  protected readonly loaded = signal(false);
  protected readonly src = computed(() => this.ui.summonerIconUrl(this.icon()));
  protected readonly badge = computed(() => this.ui.roleBadgeText(this.role()));
}
