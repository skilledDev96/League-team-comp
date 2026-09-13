import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { Comp } from '../../models/team.models';
import { TacticalBoardComponent } from './tactical-board.component';

// Local mode, the way the comps page's spec does it: no listeners, no backend.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const comp: Comp = {
  id: 'c2',
  name: 'Dive',
  picks: { Top: 'Camille', Jungle: 'Jarvan IV', Mid: 'Akali', ADC: 'Kaisa', Support: 'Nautilus' },
  category: 'Meta',
  order: 1
};

/** Hosts the board the way the Comps page does: behind a signal, removed when it asks to close. */
@Component({
  imports: [TacticalBoardComponent],
  template: `
    @if (open()) {
      <app-tactical-board [comp]="comp" [play]="null" [canEdit]="canEdit()" (close)="open.set(false)" />
    }
  `
})
class HostComponent {
  readonly comp = comp;
  readonly open = signal(true);
  readonly canEdit = signal(false);
}

const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
const realShowModal = proto.showModal;

// The board renders under TestBed, which needs the DOM that only the Angular runner (ng test,
// jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('TacticalBoardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    // jsdom has no showModal; the directive checks before calling it.
    delete proto.showModal;
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterAll(() => {
    proto.showModal = realShowModal;
  });

  const dialog = () => root.querySelector<HTMLDialogElement>('dialog.tb-modal');

  it('is a native dialog named for the reader, with no scrim of its own', () => {
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d!.getAttribute('aria-label')).toBe('Tactical board');
    // A <dialog> already carries role dialog and is modal; nothing hand-rolled remains.
    expect(d!.getAttribute('role')).toBeNull();
    expect(d!.getAttribute('aria-modal')).toBeNull();
    expect(root.querySelector('.tb-scrim')).toBeNull();
  });

  it('shows the comp it was opened for', () => {
    expect(dialog()!.querySelector('.tb-comp-tag')?.textContent?.trim()).toBe('Dive comp');
  });

  it('Escape asks the host to take the board off the page', () => {
    const cancel = new Event('cancel', { cancelable: true });
    dialog()!.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    fixture.detectChanges();
    expect(host.open()).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('a click on the backdrop dismisses it', () => {
    dialog()!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: -10, clientY: -10 }));
    fixture.detectChanges();
    expect(host.open()).toBe(false);
  });

  it('the Close pill in the head dismisses it', () => {
    root.querySelector<HTMLButtonElement>('.tb-close')!.click();
    fixture.detectChanges();
    expect(host.open()).toBe(false);
  });

  it('Cancel in the foot dismisses it', () => {
    // The foot is only there for someone who can edit.
    host.canEdit.set(true);
    fixture.detectChanges();
    const cancel = Array.from(root.querySelectorAll<HTMLButtonElement>('.tb-foot .view-btn')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    );
    expect(cancel).toBeDefined();
    cancel!.click();
    fixture.detectChanges();
    expect(host.open()).toBe(false);
  });
});
