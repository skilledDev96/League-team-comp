import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { OverflowMenuComponent } from '../../../shared/overflow-menu.component';
import { AdminContextService } from '../admin-context.service';

/** Stand-ins available when the roster is short. */
@Component({
  selector: 'app-admin-fill-ins',
  imports: [OverflowMenuComponent, NgModelNameDirective, FormsModule],
  templateUrl: './fill-ins.component.html'
})
export class AdminFillInsComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly auth = inject(AuthService);
}
