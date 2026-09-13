import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalDirective } from './modal.directive';

@Component({
  imports: [ModalDirective],
  template: `
    @if (shown()) {
      <dialog appModal class="modal-card" aria-label="Test dialog" (closed)="shown.set(false)">
        <h2>Test dialog</h2>
        <button type="button" id="inner" (click)="clicks.set(clicks() + 1)">Inner</button>
      </dialog>
    }
  `
})
class HostComponent {
  readonly shown = signal(true);
  readonly clicks = signal(0);
}

/** The dialog's box on screen, in place of jsdom's all-zero rectangle. */
const BOX = { left: 100, top: 100, right: 500, bottom: 400 };

// jsdom has no showModal; the browser does. Both paths are pinned down here, so the prototype is
// given one for the tests that need it and put back afterwards.
const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
const realShowModal = proto.showModal;
const realClose = proto.close;

// The directive renders under TestBed, which needs the DOM that only the Angular runner
// (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof document === 'undefined')('ModalDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let root: HTMLElement;

  afterEach(() => {
    proto.showModal = realShowModal;
    proto.close = realClose;
  });

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const dialog = () => root.querySelector<HTMLDialogElement>('dialog');

  function clickDialogAt(x: number, y: number): void {
    const d = dialog()!;
    vi.spyOn(d, 'getBoundingClientRect').mockReturnValue(BOX as DOMRect);
    d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    fixture.detectChanges();
  }

  describe('opening', () => {
    it('calls showModal once it is on the page, so the dialog is modal and in the top layer', async () => {
      const showModal = vi.fn();
      proto.showModal = showModal;
      await render();
      expect(showModal).toHaveBeenCalledTimes(1);
      expect(dialog()).not.toBeNull();
    });

    it('leaves a browser without showModal alone instead of throwing', async () => {
      delete proto.showModal;
      await render();
      expect(dialog()).not.toBeNull();
      expect(dialog()!.getAttribute('aria-label')).toBe('Test dialog');
    });

    it('does not open a dialog that is already open', async () => {
      const showModal = vi.fn();
      proto.showModal = showModal;
      // The element is created open by the host before the first render completes.
      TestBed.overrideTemplate(
        HostComponent,
        `@if (shown()) { <dialog appModal open class="modal-card" (closed)="shown.set(false)"></dialog> }`
      );
      await render();
      expect(showModal).not.toHaveBeenCalled();
    });
  });

  describe('Escape', () => {
    beforeEach(async () => {
      delete proto.showModal;
      await render();
    });

    it('prevents the native close so the host removes the element itself', () => {
      const cancel = new Event('cancel', { cancelable: true });
      dialog()!.dispatchEvent(cancel);
      expect(cancel.defaultPrevented).toBe(true);
      fixture.detectChanges();
      expect(host.shown()).toBe(false);
      expect(dialog()).toBeNull();
    });

    it('a close the browser performed on its own is reported too, so the host cannot hold a shut dialog open', () => {
      dialog()!.dispatchEvent(new Event('close'));
      fixture.detectChanges();
      expect(host.shown()).toBe(false);
      expect(dialog()).toBeNull();
    });
  });

  describe('clicks', () => {
    beforeEach(async () => {
      delete proto.showModal;
      await render();
    });

    it('closes on a click on the backdrop: the dialog element, outside its box', () => {
      clickDialogAt(20, 20);
      expect(host.shown()).toBe(false);
      expect(dialog()).toBeNull();
    });

    it('stays open on a click on its own padding: the dialog element, inside its box', () => {
      clickDialogAt(105, 105);
      expect(host.shown()).toBe(true);
      expect(dialog()).not.toBeNull();
    });

    it('stays open on a click on its contents, which reach the dialog by bubbling', () => {
      const inner = root.querySelector<HTMLButtonElement>('#inner')!;
      inner.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 }));
      fixture.detectChanges();
      expect(host.clicks()).toBe(1);
      expect(host.shown()).toBe(true);
      expect(dialog()).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('closes the native dialog if it is still open when the host removes it', async () => {
      delete proto.showModal;
      await render();
      const d = dialog()!;
      const close = vi.fn();
      d.close = close;
      d.setAttribute('open', '');
      expect(d.open).toBe(true);
      host.shown.set(false);
      fixture.detectChanges();
      expect(dialog()).toBeNull();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('does not call close on a dialog that is already shut', async () => {
      delete proto.showModal;
      await render();
      const d = dialog()!;
      const close = vi.fn();
      d.close = close;
      host.shown.set(false);
      fixture.detectChanges();
      expect(close).not.toHaveBeenCalled();
    });
  });
});
