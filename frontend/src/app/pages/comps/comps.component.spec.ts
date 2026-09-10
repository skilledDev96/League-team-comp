import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { Comp } from '../../models/team.models';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { TeamDataService } from '../../services/team-data.service';
import { CompsComponent } from './comps.component';

// Local mode, the way the film page's spec does it: no listeners, no backend, and
// whatever the test sets on the signals is what the page reads.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const c1: Comp = {
  id: 'c1',
  name: 'Front to back',
  picks: { Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona' },
  order: 0
};

const c2: Comp = {
  id: 'c2',
  name: 'Dive',
  picks: { Top: 'Camille', Jungle: 'Jarvan IV', Mid: 'Akali', ADC: 'Kaisa', Support: 'Nautilus' },
  category: 'Meta',
  order: 1
};

function panel(root: HTMLElement, id: string): HTMLDetailsElement | null {
  return root.querySelector<HTMLDetailsElement>(`[data-comp="${id}"] details.comp-panel`);
}

/** The reveal scrolls after a short timer, once the panel has unfolded; this waits it out. */
function afterTheScroll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

async function open(url: string): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, CompsComponent);
  // One turn for the reveal's own navigation, which drops the param, then the page again.
  await harness.fixture.whenStable();
  harness.detectChanges();
  return { harness, root: harness.routeNativeElement as HTMLElement };
}

// The page renders under TestBed, which needs the DOM that only the Angular
// runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('CompsComponent', () => {
  let data: TeamDataService;
  let scroll: ReturnType<typeof vi.fn<HTMLElement['scrollIntoView']>>;
  const realScroll = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    localStorage.clear();
    // The champion filter keeps its value in sessionStorage across pages; one test sets it, and no test should inherit it.
    sessionStorage.clear();
    // jsdom has no scrollIntoView; the reveal checks for one before calling it, so the stub is what proves the scroll.
    scroll = vi.fn<HTMLElement['scrollIntoView']>();
    HTMLElement.prototype.scrollIntoView = scroll;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'comps', component: CompsComponent }])] });
    data = TestBed.inject(TeamDataService);
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = realScroll;
  });

  it('opens the comp ?comp= names, scrolls its card to the top and drops the param', async () => {
    data.comps.set([c1, c2]);
    const { root } = await open('/comps?comp=c2');
    expect(panel(root, 'c2')?.open).toBe(true);
    expect(panel(root, 'c1')?.open).toBe(false);
    // Dropped so a reload, or a later link, starts clean.
    expect(TestBed.inject(Router).url).toBe('/comps');
    await afterTheScroll();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0][0]).toMatchObject({ block: 'start' });
    expect((scroll.mock.contexts[0] as HTMLElement).getAttribute('data-comp')).toBe('c2');
  });

  it('waits for the list when the page arrives before the comps do', async () => {
    data.comps.set([]);
    const { harness, root } = await open('/comps?comp=c2');
    expect(panel(root, 'c2')).toBeNull();
    // The listener lands: the effect runs again and the card unfolds.
    data.comps.set([c1, c2]);
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(panel(root, 'c2')?.open).toBe(true);
    expect(panel(root, 'c1')?.open).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/comps');
    // The late card is scrolled to as well; waiting it out here also keeps the timer out of the next test.
    await afterTheScroll();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.contexts[0] as HTMLElement).getAttribute('data-comp')).toBe('c2');
  });

  it('clears the champion filter when it would hide the comp the link names, and keeps it when the comp carries the champion', async () => {
    // The filter only counts a name the champion index knows; the index reads its cache when the service is built.
    localStorage.setItem(
      'bom-ddragon-v1',
      JSON.stringify({
        version: '14.24.1',
        champions: [
          { id: 'Ahri', key: '103', name: 'Ahri', title: '', tags: [] },
          { id: 'Jinx', key: '222', name: 'Jinx', title: '', tags: [] }
        ]
      })
    );
    data.comps.set([c1, c2]);
    const filter = TestBed.inject(ChampionFilterService);
    // Filtered on a champion c1 lacks earlier in the tab, the way Games leaves it: the link to c1 still shows c1.
    filter.set('Ahri');
    expect(filter.active()).toBe('Ahri');
    const { harness, root } = await open('/comps?comp=c1');
    expect(filter.value()).toBe('');
    expect(panel(root, 'c1')?.open).toBe(true);
    expect(root.querySelector('[data-comp="c1"]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/comps');
    await afterTheScroll();

    // A filter the comp passes is somebody's question and stays.
    filter.set('Jinx');
    await harness.navigateByUrl('/comps?comp=c1', CompsComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(filter.value()).toBe('Jinx');
    expect(panel(root, 'c1')?.open).toBe(true);
    expect(root.querySelector('[data-comp="c2"]')).toBeNull();
    await afterTheScroll();
    filter.clear();
  });

  it('opens nothing and keeps the param when no comp carries the id', async () => {
    data.comps.set([c1, c2]);
    const { root } = await open('/comps?comp=gone');
    expect(panel(root, 'c1')?.open).toBe(false);
    expect(panel(root, 'c2')?.open).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/comps?comp=gone');
    await afterTheScroll();
    expect(scroll).not.toHaveBeenCalled();
  });
});
