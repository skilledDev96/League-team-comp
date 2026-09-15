import { describe, expect, it } from 'vitest';
import { ConfirmService } from './confirm.service';

describe('ConfirmService', () => {
  it('resolves true only when the confirm button answers, and clears the request', async () => {
    const svc = new ConfirmService();
    const yes = svc.ask({ title: 'Delete the series against 5s?', confirmLabel: 'Delete series', danger: true });
    expect(svc.request()).toMatchObject({ title: 'Delete the series against 5s?', confirmLabel: 'Delete series', danger: true });
    svc.answer(true);
    await expect(yes).resolves.toBe(true);
    expect(svc.request()).toBeNull();

    const no = svc.ask({ title: 'Remove game 2?', confirmLabel: 'Remove game' });
    svc.answer(false);
    await expect(no).resolves.toBe(false);
  });

  it('cancels an open question when a second one is asked, so dialogs never stack', async () => {
    const svc = new ConfirmService();
    const first = svc.ask({ title: 'First?', confirmLabel: 'Go' });
    const second = svc.ask({ title: 'Second?', confirmLabel: 'Go' });
    await expect(first).resolves.toBe(false);
    expect(svc.request()?.title).toBe('Second?');
    svc.answer(true);
    await expect(second).resolves.toBe(true);
  });
});
