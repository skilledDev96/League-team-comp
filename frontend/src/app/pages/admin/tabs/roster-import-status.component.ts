import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { AdminContextService } from '../admin-context.service';

/**
 * The roster importer's progress block and results card, as Admin › Players drew them since 27 Sep
 * 2026, lifted out unchanged the same day so Admin › Teams shows the import it started the same way
 * (Stage 3). One template, one set of ids (`roster-import-progress`, `roster-import-results`,
 * `roster-import-reseat`, `roster-import-scout`, `roster-import-games`), read off the same root
 * service through the admin context. The host is `display: contents`, so the two blocks sit in the
 * tab's flow exactly as they did when they were its own markup.
 */
@Component({
  selector: 'app-roster-import-status',
  imports: [TooltipDirective, RouterLink],
  host: { style: 'display: contents' },
  templateUrl: './roster-import-status.component.html'
})
export class RosterImportStatusComponent {
  protected readonly ctx = inject(AdminContextService);
}
