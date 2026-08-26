import { Directive, ElementRef, HostListener, inject, input, OnDestroy } from '@angular/core';
import { placeTooltip } from './tooltip-position.util';

/**
 * Replaces the native `title` tooltip.
 *
 * `title` is rendered by the operating system: it waits about a second, ignores
 * the theme, wraps where it likes, and never appears for keyboard users. This
 * shows the same text immediately, in our own styling, and on focus as well as
 * hover.
 *
 * The tooltip is a `popover`, so it lives in the top layer and cannot be
 * clipped by a scrolling ancestor — which matters here, since most of these sit
 * inside game panels and overflow containers.
 */
@Directive({
  selector: '[appTip]'
})
export class TooltipDirective implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly appTip = input<string>('');

  private tip?: HTMLElement;
  private readonly dismiss = () => this.hide();

  @HostListener('mouseenter')
  @HostListener('focus')
  protected show(): void {
    const text = this.appTip()?.trim();
    if (!text || this.tip) return;

    const tip = document.createElement('div');
    tip.className = 'app-tip';
    tip.textContent = text;
    tip.setAttribute('role', 'tooltip');
    tip.popover = 'manual';
    document.body.appendChild(tip);
    tip.showPopover();

    this.tip = tip;
    this.position(tip);

    // Fixed to the viewport and positioned once, so any scroll leaves it
    // stranded. Capture, because the scroll is usually an inner container.
    window.addEventListener('scroll', this.dismiss, { capture: true, once: true });
  }

  // A click usually changes what the control says, so the old text has to go.
  @HostListener('click')
  @HostListener('mouseleave')
  @HostListener('blur')
  @HostListener('document:keydown.escape')
  protected hide(): void {
    if (!this.tip) return;
    window.removeEventListener('scroll', this.dismiss, { capture: true });
    this.tip.hidePopover();
    this.tip.remove();
    this.tip = undefined;
  }

  private position(tip: HTMLElement): void {
    const at = placeTooltip(
      this.host.nativeElement.getBoundingClientRect(),
      tip.getBoundingClientRect(),
      window.innerWidth
    );

    tip.classList.toggle('is-below', at.below);
    tip.style.top = `${at.top}px`;
    tip.style.left = `${at.left}px`;
    tip.style.setProperty('--tip-arrow', `${at.arrow}px`);
  }

  ngOnDestroy(): void {
    this.hide();
  }
}
