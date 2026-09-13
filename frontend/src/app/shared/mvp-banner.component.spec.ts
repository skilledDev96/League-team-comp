import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../environments/environment';
import { LastCrown } from '../core/mvp-race';
import { LastMvpService } from '../services/last-mvp.service';
import { MvpBannerComponent } from './mvp-banner.component';

// Local mode, the way the chip's spec does it.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const crown: LastCrown = { seriesId: 's1', opponent: 'Tidal Wolves', result: 'won', at: Date.parse('2026-09-06T20:00'), playerId: 'p-adc', name: 'Rhu', champion: 'Jinx', seat: 'ADC' };

/** The service with a holder set by hand, so the banner is tested on its own. */
class FakeLastMvp {
  readonly holder = signal<LastCrown | null>(crown);
  readonly holderName = signal<string | null>('Rhu');
  isHolder(playerId?: string | null, name?: string | null): boolean {
    const h = this.holder();
    if (!h) return false;
    if (playerId && h.playerId) return playerId === h.playerId;
    return !!name && name.toLowerCase() === (this.holderName() ?? '').toLowerCase();
  }
}

describe.skipIf(typeof localStorage === 'undefined')('MvpBannerComponent', () => {
  let fake: FakeLastMvp;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    fake = new FakeLastMvp();
    TestBed.configureTestingModule({ providers: [{ provide: LastMvpService, useValue: fake }] });
  });

  function mount(inputs: { playerId?: string | null; name?: string | null; size?: 'chip' | 'inline' | 'tile' }) {
    const fixture = TestBed.createComponent(MvpBannerComponent);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('shows beside the holder, by id or by name, with the series in the tip, and nothing beside anyone else', () => {
    const byId = mount({ playerId: 'p-adc' });
    expect(byId.root.querySelector('.mvp-banner')).not.toBeNull();
    expect(byId.root.querySelector('.visually-hidden')?.textContent).toContain('MVP of the last series: vs Tidal Wolves, Jinx on 6 Sept');
    const byName = mount({ name: 'rhu' });
    expect(byName.root.querySelector('.mvp-banner')).not.toBeNull();
    expect(mount({ playerId: 'p-mid' }).root.querySelector('.mvp-banner')).toBeNull();
    expect(mount({ name: 'Mido' }).root.querySelector('.mvp-banner')).toBeNull();
    expect(mount({}).root.querySelector('.mvp-banner')).toBeNull();
  });

  it('wears its size and vanishes when the crown moves on', () => {
    const { fixture, root } = mount({ playerId: 'p-adc', size: 'inline' });
    expect(root.querySelector('.mvp-banner')?.classList.contains('is-inline')).toBe(true);
    fake.holder.set({ ...crown, playerId: 'p-mid', name: 'Mido' });
    fake.holderName.set('Mido');
    fixture.detectChanges();
    expect(root.querySelector('.mvp-banner')).toBeNull();
  });
});
