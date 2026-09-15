import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { Comp } from '../../models/team.models';
import { AuthService } from '../../services/auth.service';
import { ChampionFilterService } from '../../services/champion-filter.service';
import { ConfirmService } from '../../services/confirm.service';
import { TeamDataService } from '../../services/team-data.service';
import { UserPrefsService } from '../../services/user-prefs.service';
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

const opener = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`#comps-open-${id}`);
const sheets = (root: HTMLElement) => root.querySelectorAll('.comps-sheet');
const sheetTitle = (root: HTMLElement) => root.querySelector('#comps-sheet-title')?.textContent?.trim() ?? null;

/** The reveal scrolls after a short timer; this waits it out. */
function afterTheScroll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  await harness.fixture.whenStable();
  harness.detectChanges();
}

async function open(url: string): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, CompsComponent);
  // One turn for the reveal's own navigation, which drops the param, then the page again.
  await settle(harness);
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
    TestBed.inject(AuthService).editMode.set(false);
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = realScroll;
  });

  it('opens the comp ?comp= names, scrolls its tile to the top and drops the param', async () => {
    data.comps.set([c1, c2]);
    const { root } = await open('/comps?comp=c2');
    expect(opener(root, 'c2')?.getAttribute('aria-expanded')).toBe('true');
    expect(opener(root, 'c1')?.getAttribute('aria-expanded')).toBe('false');
    expect(sheetTitle(root)).toBe('Dive');
    expect(TestBed.inject(Router).url).toBe('/comps');
    await afterTheScroll();
    // The tile is scrolled to as well; waiting it out here also keeps the timer out of the next test.
    const tile = scroll.mock.contexts.find((el) => (el as HTMLElement).getAttribute?.('data-comp'));
    expect((tile as HTMLElement).getAttribute('data-comp')).toBe('c2');
  });

  it('waits for the list when the page arrives before the comps do', async () => {
    const { harness, root } = await open('/comps?comp=c2');
    expect(sheets(root)).toHaveLength(0);
    expect(TestBed.inject(Router).url).toBe('/comps?comp=c2');
    data.comps.set([c1, c2]);
    await settle(harness);
    expect(sheetTitle(root)).toBe('Dive');
    expect(TestBed.inject(Router).url).toBe('/comps');
    await afterTheScroll();
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
    expect(sheetTitle(root)).toBe('Front to back');
    expect(root.querySelector('[data-comp="c1"]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/comps');
    await afterTheScroll();

    // A filter the comp passes is somebody's question and stays.
    filter.set('Jinx');
    await harness.navigateByUrl('/comps?comp=c1', CompsComponent);
    await settle(harness);
    expect(filter.value()).toBe('Jinx');
    expect(sheetTitle(root)).toBe('Front to back');
    expect(root.querySelector('[data-comp="c2"]')).toBeNull();
    expect(root.querySelector('[data-comp="c1"] .comps-tile')?.classList.contains('is-match')).toBe(true);
    await afterTheScroll();
    filter.clear();
  });

  it('opens nothing and keeps the param when no comp carries the id', async () => {
    data.comps.set([c1, c2]);
    const { root } = await open('/comps?comp=gone');
    expect(sheets(root)).toHaveLength(0);
    expect(TestBed.inject(Router).url).toBe('/comps?comp=gone');
    await afterTheScroll();
    expect(scroll).not.toHaveBeenCalled();
  });

  // One sheet at a time, built only while a comp is open: the old panels built every comp's board and a wall of
  // about 170 champions in edit mode whether anyone could see them or not.
  it('builds one sheet only while a comp is open, moves it to the comp clicked, and closes on the tile or Escape', async () => {
    data.comps.set([c1, c2]);
    const { harness, root } = await open('/comps');
    expect(sheets(root)).toHaveLength(0);
    opener(root, 'c1')!.click();
    await settle(harness);
    expect(sheets(root)).toHaveLength(1);
    expect(root.querySelector('.comps-sheet .comps-seats')).not.toBeNull();
    expect(sheetTitle(root)).toBe('Front to back');
    opener(root, 'c2')!.click();
    await settle(harness);
    expect(sheets(root)).toHaveLength(1);
    expect(sheetTitle(root)).toBe('Dive');
    opener(root, 'c2')!.click();
    await settle(harness);
    expect(sheets(root)).toHaveLength(0);
    opener(root, 'c1')!.click();
    await settle(harness);
    root.querySelector('.comps-sheet')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(harness);
    expect(sheets(root)).toHaveLength(0);
  });

  it('opens the first comp at Full and pins it, adding each result, which Starter leaves out', async () => {
    data.comps.set([c1, c2]);
    data.compResults.set([
      { id: 'r1', compId: 'c1', outcome: 'win', playedOn: '2026-09-01', order: 0 },
      { id: 'r2', compId: 'c1', outcome: 'loss', playedOn: '2026-09-02', order: 1 }
    ]);
    const { harness, root } = await open('/comps?comp=c1');
    await afterTheScroll();
    expect(sheetTitle(root)).toBe('Front to back');
    expect(root.querySelectorAll('.comps-result')).toHaveLength(0);

    const prefs = TestBed.inject(UserPrefsService);
    await prefs.setDepth('comps', true);
    await settle(harness);
    expect(sheetTitle(root)).toBe('Front to back');
    expect(root.querySelectorAll('.comps-result')).toHaveLength(2);
    // A click turns the choice against the depth; the sheet follows the comp, one at a time.
    opener(root, 'c2')!.click();
    await settle(harness);
    expect(sheets(root)).toHaveLength(1);
    expect(sheetTitle(root)).toBe('Dive');
    await prefs.setDepth('comps', false);
    await settle(harness);
    expect(sheets(root)).toHaveLength(0);
  });

  it('adds a comp from the hero pill with edit mode off, turning it on and opening the sheet on the name; Enter renames, an empty name reverts', async () => {
    data.comps.set([c1, c2]);
    const auth = TestBed.inject(AuthService);
    const { harness, root } = await open('/comps');
    expect(auth.editMode()).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-tour="comps-add"]')!.click();
    await settle(harness);
    await settle(harness);
    expect(auth.editMode()).toBe(true);
    expect(data.comps()).toHaveLength(3);
    const added = data.comps()[2];
    expect(added.name).toBe('New comp 3');
    expect(opener(root, added.id)?.getAttribute('aria-expanded')).toBe('true');
    const name = root.querySelector<HTMLInputElement>('#comps-sheet-rename');
    expect(name).not.toBeNull();
    expect(root.querySelector('.comps-sheet app-comp-board')).not.toBeNull();

    name!.value = 'Poke';
    name!.dispatchEvent(new Event('input', { bubbles: true }));
    name!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    name!.dispatchEvent(new Event('blur'));
    await settle(harness);
    expect(data.comps()[2].name).toBe('Poke');

    name!.value = '   ';
    name!.dispatchEvent(new Event('input', { bubbles: true }));
    name!.dispatchEvent(new Event('blur'));
    await settle(harness);
    expect(data.comps()[2].name).toBe('Poke');
  });

  it('deletes a comp from the sheet after a confirm, taking its results with it, and lands focus on the next tile', async () => {
    data.comps.set([c1, c2]);
    data.compResults.set([{ id: 'r1', compId: 'c1', outcome: 'win', playedOn: '2026-09-01', order: 0 }]);
    TestBed.inject(AuthService).editMode.set(true);
    const asked: string[] = [];
    vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockImplementation(async (req) => {
      asked.push(`${req.title} ${req.body ?? ''}`.trim());
      return true;
    });
    try {
      const { harness, root } = await open('/comps?comp=c1');
      await afterTheScroll();
      root.querySelector<HTMLButtonElement>('.comps-sheet .overflow-trigger')?.click();
      await settle(harness);
      root.querySelector<HTMLButtonElement>('.comps-sheet .overflow-item.danger')!.click();
      await settle(harness);
      await settle(harness);
      expect(asked[0]).toBe('Delete Front to back? Its 1 logged result goes too.');
      expect(data.comps().map((c) => c.id)).toEqual(['c2']);
      expect(data.compResults()).toHaveLength(0);
      expect(sheets(root)).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
