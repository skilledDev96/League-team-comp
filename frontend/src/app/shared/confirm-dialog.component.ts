import { afterRenderEffect, Component, ElementRef, inject, viewChild } from '@angular/core';
import { ConfirmService } from '../services/confirm.service';
import { ModalDirective } from './modal.directive';

/**
 * The app's one confirmation dialog (15 Sep 2026), mounted once in the shell and driven by
 * `ConfirmService`. A native `<dialog>` through `appModal`: in the top layer, so it never moves the
 * draft room or anything else; the page behind is inert. Cancel takes focus when it opens, so a
 * reflexive Enter cancels instead of deleting; Escape and the backdrop cancel too.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [ModalDirective],
  template: `
    @if (confirm.request(); as req) {
      <dialog appModal class="modal-card confirm-dialog" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-body" (closed)="confirm.answer(false)">
        <h2 id="confirm-dialog-title" class="confirm-dialog-title">
          @if (req.danger) {
            <span class="material-symbols-rounded" aria-hidden="true">warning</span>
          }
          {{ req.title }}
        </h2>
        @if (req.body) {
          <p id="confirm-dialog-body" class="confirm-dialog-body">{{ req.body }}</p>
        }
        <div class="confirm-dialog-actions">
          <button #cancel type="button" class="view-btn" (click)="confirm.answer(false)">{{ req.cancelLabel || 'Cancel' }}</button>
          <button type="button" class="view-btn confirm-dialog-go" [class.is-danger]="req.danger" (click)="confirm.answer(true)">{{ req.confirmLabel }}</button>
        </div>
      </dialog>
    }
  `
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');

  constructor() {
    // Cancel is focused on every new question: showModal would focus the first focusable, which is
    // Cancel today, but saying it outright keeps a future reorder from putting Delete under Enter.
    afterRenderEffect(() => {
      const req = this.confirm.request();
      const button = this.cancel()?.nativeElement;
      if (req && button && document.activeElement !== button) button.focus();
    });
  }
}
