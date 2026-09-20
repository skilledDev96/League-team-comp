import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AnalysisGame, Comp, CompAnalysis } from '../../models/team.models';
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

/**
 * A seat holding more than one champion (20 Sep 2026, the lead: "the dive comp has naut a priority but Leona
 * can also be added as a secondary pick"). Support keeps two behind Nautilus, Top one behind Camille.
 */
const c3: Comp = {
  id: 'c3',
  name: 'Naut dive',
  picks: { Top: 'Camille', Jungle: 'Vi', Mid: 'Akali', ADC: 'Kaisa', Support: 'Nautilus' },
  fallbacks: { Top: ['Gwen - into ranged'], Support: ['Leona - if Naut is gone', 'Rakan'] },
  order: 2
};

/** A game the analysis placed under a comp, carrying our five champions and nothing of theirs. */
const analysisGame = (matchId: string, compId: string, win: boolean, champions: string[]): AnalysisGame => ({
  matchId,
  compId,
  compName: null,
  win,
  queue: 'Flex',
  date: 1_700_000_000_000,
  players: champions.map((champion, k) => ({
    name: `P${k}`,
    position: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][k] ?? '',
    champion,
    kills: 1,
    deaths: 1,
    assists: 1,
    cs: 100,
    damage: 1000
  }))
});

const analysis = (games: AnalysisGame[]) => ({ comps: [], games, totalTeamGames: games.length, scannedMatches: games.length }) as unknown as CompAnalysis;

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

  // A seat that holds more than one champion (20 Sep 2026). The tile keeps its five icons and its height, so the
  // count of what a seat holds in reserve goes inside the seat's own icon; the sheet has the room to name them.
  it('marks a seat holding fallbacks on the tile, names them as chips in the sheet, and answers the filter with them', async () => {
    localStorage.setItem(
      'bom-ddragon-v1',
      JSON.stringify({ version: '14.24.1', champions: [{ id: 'Leona', key: '89', name: 'Leona', title: '', tags: [] }] })
    );
    data.comps.set([c1, c3]);
    const { harness, root } = await open('/comps');

    const icons = () => [...root.querySelectorAll('[data-comp="c3"] .comps-tile-five li')];
    expect(icons()).toHaveLength(5);
    expect(icons().map((li) => li.querySelector('.comps-tile-more')?.textContent?.trim() ?? '')).toEqual(['+1', '', '', '', '+2']);
    // The tip is hover and focus only, so the names are in the DOM for a reader who gets neither.
    expect(icons()[4].querySelector('.visually-hidden')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(', or Leona, Rakan');

    opener(root, 'c3')!.click();
    await settle(harness);
    const seats = [...root.querySelectorAll('.comps-sheet .comps-seat')];
    expect(seats).toHaveLength(5);
    expect(seats[4].querySelector('.comps-seat-champ')?.textContent?.trim()).toBe('Nautilus');
    expect([...seats[4].querySelectorAll('.comps-seat-fallback span')].map((el) => el.textContent?.trim())).toEqual(['Leona', 'Rakan']);
    // A seat with nothing behind its priority looks exactly as it did.
    expect(seats[1].querySelector('.comps-seat-fallbacks')).toBeNull();

    // Both comps answer for Leona: c1 fields her, c3 keeps her behind Nautilus — and the lit seat says which.
    const filter = TestBed.inject(ChampionFilterService);
    filter.set('Leona');
    await settle(harness);
    expect([...root.querySelectorAll('[data-comp]')].map((li) => li.getAttribute('data-comp'))).toEqual(['c1', 'c3']);
    // And the toolbar's own answer says which is which (20 Sep 2026): one flat "Drafted in Front to back, Naut
    // dive." would say the dive comp drafts Leona, contradicted by its five icons and its "+1" mark just below.
    expect(root.querySelector('.champ-filter-answer')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Drafted in Front to back. In reserve in Naut dive.');
    expect(root.querySelector('[data-comp="c3"] .comps-tile')?.classList.contains('is-match')).toBe(true);
    expect(icons().map((li) => li.classList.contains('is-match'))).toEqual([false, false, false, false, true]);
    expect(seats[4].classList.contains('is-match')).toBe(true);
    filter.clear();
    await afterTheScroll();
  });

  // The receipt the lead asked for: a game played with a listed fallback counts as the comp, and the record says
  // how many of them did.
  it('says how many of a comp’s games were fielded on a fallback, leaving the headline alone and other comps unmarked', async () => {
    data.comps.set([c1, c3]);
    data.compAnalysis.set(
      analysis([
        analysisGame('EUW_1', 'c3', true, ['Camille', 'Vi', 'Akali', 'Kaisa', 'Leona']),
        analysisGame('EUW_2', 'c3', false, ['Camille', 'Vi', 'Akali', 'Kaisa', 'Nautilus']),
        analysisGame('EUW_3', 'c1', true, ['Ornn', 'Trundle', 'Orianna', 'Jinx', 'Leona'])
      ])
    );
    const { harness, root } = await open('/comps?comp=c3');
    await afterTheScroll();
    const receipt = () => root.querySelector('.comps-record-fallback')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    expect(receipt()).toBe('alt_route 2 games · 1 on a fallback');
    // The headline says what it always said.
    expect(root.querySelector('.comps-record-line')?.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^1W.1L50% from match history$/);

    // A comp holding no fallbacks has no such question, however its games were played.
    await harness.navigateByUrl('/comps?comp=c1', CompsComponent);
    await settle(harness);
    expect(sheetTitle(root)).toBe('Front to back');
    expect(root.querySelector('.comps-record-line')).not.toBeNull();
    expect(receipt()).toBeNull();

    // With results logged by hand the headline counts those instead, so the receipt names where its own total
    // comes from (20 Sep 2026) — two totals stacked with nothing saying they count different things read as a
    // contradiction: "3W–2L logged by hand" over a bare "2 games".
    data.compResults.set([
      { id: 'x1', compId: 'c3', outcome: 'win', playedOn: '2026-09-01', order: 0 },
      { id: 'x2', compId: 'c3', outcome: 'win', playedOn: '2026-09-02', order: 1 },
      { id: 'x3', compId: 'c3', outcome: 'loss', playedOn: '2026-09-03', order: 2 }
    ]);
    await harness.navigateByUrl('/comps?comp=c3', CompsComponent);
    await settle(harness);
    expect(root.querySelector('.comps-record-line')?.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^2W.1L67% logged by hand· match history 1W.1L$/);
    expect(receipt()).toBe('alt_route 2 games from match history · 1 on a fallback');
    await afterTheScroll();
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
