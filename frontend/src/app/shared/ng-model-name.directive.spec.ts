import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { NgModelNameDirective } from './ng-model-name.directive';

@Component({
  imports: [FormsModule, NgModelNameDirective],
  template: `
    <input id="bound" type="text" [ngModel]="value()" [name]="'opp-' + id()" />
    <input id="static" type="text" [ngModel]="value()" name="fixed" />
    <textarea id="area" [ngModel]="value()" [name]="'note-' + id()"></textarea>
    <input id="plain" type="text" [ngModel]="value()" />
  `
})
class HostComponent {
  readonly value = signal('');
  readonly id = signal('abc');
}

/** The same markup without the directive, to pin down why it is needed. */
@Component({
  imports: [FormsModule],
  template: `<input id="bare" type="text" [ngModel]="''" [name]="'opp-abc'" />`
})
class UnfixedComponent {}

describe('NgModelNameDirective', () => {
  let host: HTMLElement;

  beforeEach(async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    host = fixture.nativeElement as HTMLElement;
  });

  function nameOf(id: string): string | null {
    return host.querySelector(`#${id}`)!.getAttribute('name');
  }

  it('puts a bound name onto the element, which NgModel would otherwise swallow', () => {
    expect(nameOf('bound')).toBe('opp-abc');
  });

  it('leaves a static name alone', () => {
    expect(nameOf('static')).toBe('fixed');
  });

  it('covers textareas as well as inputs', () => {
    expect(nameOf('area')).toBe('note-abc');
  });

  it('does not invent a name for a field that never had one', () => {
    expect(nameOf('plain')).toBeNull();
  });

  it('is needed because NgModel claims [name] as a directive input', async () => {
    const fixture = TestBed.createComponent(UnfixedComponent);
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('#bare')!;
    // Without the directive the binding never reaches the element, which is the
    // whole bug: the field looks named in the template and is not in the DOM.
    expect(input.getAttribute('name')).toBeNull();
  });
});
