import { Directive, ElementRef, inject, OnInit } from '@angular/core';
import { NgModel } from '@angular/forms';

/**
 * Puts the field's name back on the element.
 *
 * `NgModel` declares `name` as a directive input, so `[name]="'opp-' + id"` is
 * consumed by the directive and never reaches the DOM — the field ends up with
 * no `name` attribute at all, which browsers flag and autofill can't work with.
 * A static `name="x"` doesn't have the problem, because the attribute is
 * written to the element as well as read by the directive.
 *
 * Applies itself wherever that combination appears, so fields added later are
 * covered without anyone having to remember this.
 */
@Directive({
  selector: 'input[ngModel][name], textarea[ngModel][name], select[ngModel][name]'
})
export class NgModelNameDirective implements OnInit {
  private readonly model = inject(NgModel, { self: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnInit(): void {
    const name = this.model.name;
    if (name) {
      this.host.nativeElement.setAttribute('name', name);
    }
  }
}
