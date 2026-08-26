import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';
import { OverflowMenuComponent } from '../../../shared/overflow-menu.component';
import { AdminContextService } from '../admin-context.service';

/** Team compositions and their picks. */
@Component({
  selector: 'app-admin-comps',
  imports: [OverflowMenuComponent, NgModelNameDirective, FormsModule],
  templateUrl: './comps.component.html'
})
export class AdminCompsComponent {
  protected readonly ctx = inject(AdminContextService);
  protected readonly auth = inject(AuthService);
}
