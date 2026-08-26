import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { ChampionPickerComponent } from '../../../shared/champion-picker.component';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { OverflowMenuComponent } from '../../../shared/overflow-menu.component';
import { PlayerAvatarComponent } from '../../../shared/player-avatar.component';
import { AdminContextService } from '../admin-context.service';

/** The roster: profiles, pools and Riot autofill. */
@Component({
  selector: 'app-admin-players',
  imports: [PlayerAvatarComponent, OverflowMenuComponent, ChampionPickerComponent, NgModelNameDirective, FormsModule],
  templateUrl: './players.component.html'
})
export class AdminPlayersComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly auth = inject(AuthService);
}
