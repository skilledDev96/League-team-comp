import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';

/**
 * The account chip in the topbar, doubling as the entry point for admin pages.
 * Those used to hide behind a gear icon that only appeared in edit mode, which
 * made them hard to find; a persistent menu on the user chip is where people
 * already look for account and admin actions.
 */
@Component({
  selector: 'app-user-menu',
  template: `
    <div class="user-menu">
      <button type="button" class="user-chip user-chip-trigger" [class.active]="open()"
              [attr.aria-expanded]="open()" aria-haspopup="menu"
              (click)="toggle($event)">
        <span class="user-avatar" aria-hidden="true">{{ (email() || '?').charAt(0).toUpperCase() }}</span>
        <span class="user-name">{{ email() }}</span>
        @if (role()) { <span class="tag good">{{ role() }}</span> }
        <span class="material-symbols-rounded user-menu-chevron" aria-hidden="true">expand_more</span>
      </button>
      @if (open()) {
        <div class="user-menu-panel" role="menu" (click)="close()">
          <ng-content />
        </div>
      }
    </div>
  `
})
export class UserMenuComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly email = input<string>('');
  readonly role = input<string>('');

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
