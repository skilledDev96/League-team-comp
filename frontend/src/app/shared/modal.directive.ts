import { afterNextRender, Directive, ElementRef, HostListener, inject, OnDestroy, output } from '@angular/core';

/**
 * A native `<dialog>` that is modal for as long as it is on the page.
 *
 * The host keeps the dialog behind an `@if`, the way the draft room keeps its comps board: the
 * signal says whether it exists, and this directive does the rest. On render it calls
 * `showModal()`, so the dialog sits in the top layer — above the edit-mode banner, the toasts and
 * everything else with a z-index — with the page behind it inert, focus held inside, and Escape
 * wired up by the browser.
 *
 * Escape arrives as `cancel`. It is prevented and reported through `closed` instead, so the host's
 * `@if` removes the element; left to the browser, the dialog would shut behind the signal's back
 * and the host would still believe it open. A click that lands on the dialog element itself and
 * outside its box is the backdrop, and closes it the same way; a click on the dialog's own padding
 * is inside the box and does nothing, so the card's contents need no wrapper. Should the browser
 * ever shut the dialog on its own regardless — a `cancel` it refused to make cancelable — the
 * native `close` is reported the same way, so the host can never hold a signal open over a shut
 * dialog.
 *
 * jsdom has no `showModal`; the guards leave it alone.
 */
@Directive({
  selector: 'dialog[appModal]'
})
export class ModalDirective implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLDialogElement>>(ElementRef);

  /** Escape, or a click on the backdrop. The host takes the dialog off the page. */
  readonly closed = output<void>();

  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      const dialog = this.host.nativeElement;
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
    });
  }

  @HostListener('cancel', ['$event'])
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.closed.emit();
  }

  @HostListener('close')
  protected onClose(): void {
    // The close this directive performs itself on the way out reports nothing.
    if (!this.destroyed) this.closed.emit();
  }

  @HostListener('click', ['$event'])
  protected onClick(event: MouseEvent): void {
    const dialog = this.host.nativeElement;
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) this.closed.emit();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    const dialog = this.host.nativeElement;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
  }
}
