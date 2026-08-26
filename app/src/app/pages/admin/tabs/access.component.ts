import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { OverflowMenuComponent } from '../../../shared/overflow-menu.component';
import { AdminContextService } from '../admin-context.service';

/** Who can read and who can edit. */
@Component({
  selector: 'app-admin-access',
  imports: [OverflowMenuComponent, NgModelNameDirective, FormsModule],
  templateUrl: './access.component.html'
})
export class AdminAccessComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly auth = inject(AuthService);
}
