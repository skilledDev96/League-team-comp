import { Component, computed, inject, input, signal } from '@angular/core';
import { UiService } from '../services/ui.service';

@Component({
  selector: 'app-player-avatar',
  template: `
    <span class="avatar" [class.has-image]="showImage()">
      <span class="avatar-fallback">{{ ui.avatarInitial(name()) }}</span>
      @if (showImage()) {
        <img class="avatar-img" [src]="src()" [alt]="name() + ' summoner icon'"
             loading="eager" (error)="failed.set(src())" />
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

  // Tracks the src that failed so we fall back to the initial only for a genuinely broken image.
  protected readonly failed = signal<string | null>(null);
  protected readonly src = computed(() => this.ui.summonerIconUrl(this.icon()));
  protected readonly showImage = computed(() => !!this.src() && this.failed() !== this.src());
  protected readonly badge = computed(() => this.ui.roleBadgeText(this.role()));
}
