import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';

@Component({
  selector: 'app-overflow-menu',
  template: `
    <div class="overflow-menu">
      <button type="button" class="overflow-trigger" [class.active]="open()"
              [attr.aria-expanded]="open()" aria-haspopup="menu" aria-label="More actions"
              (click)="toggle($event)">
        <span class="material-symbols-rounded" aria-hidden="true">more_horiz</span>
      </button>
      @if (open()) {
        <div class="overflow-panel" role="menu" (click)="close()">
          <ng-content />
        </div>
      }
    </div>
  `
})
export class OverflowMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);

  protected toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
