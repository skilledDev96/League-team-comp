import { Component, inject } from '@angular/core';
import { MvpBannerComponent } from '../../../shared/mvp-banner.component';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { PlayerEditorComponent } from '../../../shared/player-editor.component';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { OverflowMenuComponent } from '../../../shared/overflow-menu.component';
import { PlayerAvatarComponent } from '../../../shared/player-avatar.component';
import { ModalDirective } from '../../../shared/modal.directive';
import { AdminContextService } from '../admin-context.service';

/** The roster: profiles, pools and Riot autofill. */
@Component({
  selector: 'app-admin-players',
  imports: [MvpBannerComponent, PlayerAvatarComponent, OverflowMenuComponent, PlayerEditorComponent, NgModelNameDirective, FormsModule, TooltipDirective, ModalDirective],
  templateUrl: './players.component.html'
})
export class AdminPlayersComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly auth = inject(AuthService);
}
