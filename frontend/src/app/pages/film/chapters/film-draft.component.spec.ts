import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmDraft, FilmModel } from '../../../core/film-model';
import { Comp, CompExpectation } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { CompExpectationService } from '../../../services/comp-expectation.service';
import { TeamDataService } from '../../../services/team-data.service';
import { ToastService } from '../../../services/toast.service';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmDraftComponent } from './film-draft.component';

/** What the expectation service would derive for the variant; the spec pins that the chapter asks it and writes the answer. */
const EXPECT = { early: 'weak', scaling: 'strong', objectives: 'even', teamfight: 'strong' } as unknown as CompExpectation;

// Local mode, the way the film page's spec does it: no listeners, no backend, and
// whatever the test sets on the signals is what the chapter reads.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const draft: FilmDraft = {
  verdict: 'The comp wanted a slow game and the fights came early.',
  ours: [
    { seat: 'Top', champion: 'Ornn', name: 'Ruan' },
    { seat: 'Jungle', champion: 'Trundle', name: 'Go10x' },
    { seat: 'Mid', champion: 'Orianna', name: 'Kai' },
    { seat: 'ADC', champion: 'Jinx', name: 'Rhu' },
    { seat: 'Support', champion: 'Leona', name: 'Nia' }
  ],
  // Out of lane order on purpose: the row is laid out in ROLES order whatever the review says.
  theirs: [
    { seat: 'Support', champion: 'Thresh' },
    { seat: 'Top', champion: 'Renekton' },
    { seat: 'Mid', champion: 'Ahri' },
    { seat: 'Jungle', champion: 'Lee Sin' },
    { seat: 'ADC', champion: 'Kaisa' }
  ],
  swaps: [{ seat: 'Support', out: 'Leona', in: 'Nautilus', why: 'Nautilus peels Jinx through the dive and still starts a fight.', gains: ['peel', 'engage'], glyphs: ['shield', 'fist'] }],
  compId: 'c1',
  compName: 'Front to back',
  variantName: null
};

const comp: Comp = {
  id: 'c1',
  name: 'Front to back',
  picks: { Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona' },
  category: 'Scaling',
  bans: ['Zed'],
  gamePlan: { early: 'Farm.' } as Comp['gamePlan'],
  order: 0
};

function modelWith(d: FilmDraft | undefined): FilmModel {
  return {
    matchId: 'EUW1_7000000001',
    tier: 'timeline',
    seed: 7,
    chapters: [],
    seats: [],
    title: {
      headline: 'Bled 35 kills while farming even',
      win: false,
      protagonist: { seat: 'ADC', champion: 'Jinx', name: 'Rhu' },
      lowerThird: { date: Date.UTC(2026, 8, 9, 20), compName: 'Front to back', compVerdict: 'off plan', compWhy: '', tier: 'timeline' }
    },
    draft: d
  } as unknown as FilmModel;
}

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The chapter renders under TestBed, which needs the DOM that only the Angular
// runner (ng test, jsdom) provides; bare vitest steps aside.
describe.skipIf(typeof localStorage === 'undefined')('FilmDraftComponent', () => {
  let data: TeamDataService;
  const canEdit = signal(true);

  function mount(model: FilmModel, active = true) {
    const fixture = TestBed.createComponent(FilmDraftComponent);
    fixture.componentRef.setInput('model', model);
    fixture.componentRef.setInput('active', active);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    localStorage.clear();
    // Motion off, as the film's own pill would set it: the tiles stand where the turn leaves them, with no timers to wait on.
    localStorage.setItem('bom-motion', 'off');
    canEdit.set(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { canEdit } },
        // The real service needs the champion index and the traits; here it stamps whatever it is handed, so the spec sees the stamp land.
        { provide: CompExpectationService, useValue: { stamped: (c: Comp) => ({ ...c, expect: EXPECT, expectSource: 'derived' }) } }
      ]
    });
    data = TestBed.inject(TeamDataService);
    data.comps.set([comp]);
  });

  it('lays out our five with names and their five without, both in lane order, with the vs between', () => {
    const root = mount(modelWith(draft)).nativeElement as HTMLElement;
    expect(text(root.querySelector('.film-draft-verdict'))).toBe(draft.verdict);
    const ours = root.querySelectorAll('.film-draft-row.is-ours .film-draft-seat');
    expect(ours).toHaveLength(5);
    expect(Array.from(ours).map((li) => text(li.querySelector('.film-draft-name')))).toEqual(['Ruan', 'Go10x', 'Kai', 'Rhu', 'Nia']);
    const theirs = root.querySelectorAll('.film-draft-row.is-theirs .film-draft-seat');
    expect(theirs).toHaveLength(5);
    expect(root.querySelectorAll('.film-draft-row.is-theirs .film-draft-name')).toHaveLength(0);
    expect(Array.from(theirs).map((li) => text(li.querySelector('.film-draft-seat-name')))).toEqual(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    expect(Array.from(theirs).map((li) => li.querySelector('img')?.getAttribute('alt'))).toEqual(['Renekton', 'Lee Sin', 'Ahri', 'Kaisa', 'Thresh']);
    expect(text(root.querySelector('.film-draft-vs'))).toBe('vs');
    // The stage's splash is the champion the coach would have drafted, undimmed.
    const art = root.querySelector('.film-chapter-art') as HTMLElement;
    expect(art.classList.contains('is-dim')).toBe(false);
    expect(art.querySelector('img')?.getAttribute('src')).toContain('nautilus');
  });

  it('turns the swapped seat at once with motion off and drops in the swap card with both champions and the gains', () => {
    const root = mount(modelWith(draft)).nativeElement as HTMLElement;
    const seat = root.querySelector('.film-draft-row.is-ours .film-draft-seat.has-swap') as HTMLElement;
    expect(text(seat.querySelector('.film-draft-seat-name'))).toBe('Support');
    expect(seat.classList.contains('is-swapped')).toBe(true);
    expect(seat.querySelector('.film-draft-tile.is-in')?.getAttribute('alt')).toBe('Nautilus');
    expect(seat.querySelector('.film-draft-badge img')).not.toBeNull();
    expect(root.querySelectorAll('.film-draft-seat.has-swap')).toHaveLength(1);

    const cards = root.querySelectorAll('.film-draft-swap');
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(text(card.querySelector('.film-draft-swap-seat'))).toBe('Support');
    expect(text(card.querySelector('.film-draft-swap-side.is-out .film-draft-champ'))).toBe('Leona');
    expect(text(card.querySelector('.film-draft-swap-side.is-in .film-draft-champ'))).toBe('Nautilus');
    expect(Array.from(card.querySelectorAll('.film-gain-chip span')).map(text)).toEqual(['Peel', 'Engage']);
    expect(Array.from(card.querySelectorAll('.film-gain-chip svg')).map((g) => g.getAttribute('data-glyph'))).toEqual(['shield', 'fist']);
    expect(card.querySelector('.film-draft-swap-glyph svg')?.getAttribute('data-glyph')).toBe('swap');
    expect(text(card.querySelector('.film-draft-swap-why'))).toBe(draft.swaps[0].why);
    expect(root.querySelector('.film-draft-held')).toBeNull();
  });

  it('holds the tiles until the chapter is on screen', () => {
    const fixture = mount(modelWith(draft), false);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.film-draft-seat.is-swapped')).toBeNull();
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    expect(root.querySelector('.film-draft-seat.is-swapped')).not.toBeNull();
  });

  it('shows the Save pill to editors only, saves a variant of the comp we played, and the pill then opens it', async () => {
    canEdit.set(false);
    const viewer = mount(modelWith(draft));
    const viewerRoot = viewer.nativeElement as HTMLElement;
    expect(viewerRoot.querySelector('.film-draft-swap .view-btn')).toBeNull();
    expect(viewerRoot.querySelector('.film-draft-swap-actions')).toBeNull();
    viewer.destroy();

    canEdit.set(true);
    const fixture = mount(modelWith(draft));
    const root = fixture.nativeElement as HTMLElement;
    const pill = root.querySelector('.film-draft-swap .view-btn') as HTMLButtonElement;
    expect(text(pill)).toContain('Save with Nautilus');
    expect(pill.disabled).toBe(false);
    // The id alone, with the list not yet carrying the comp: the pill reads from what the chapter made, not from the list.
    const create = vi.spyOn(data, 'createComp').mockResolvedValue('c2');
    pill.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledTimes(1);
    const saved = create.mock.calls[0][0];
    expect(saved.name).toBe('Front to back · Nautilus');
    expect(saved.picks).toEqual({ Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Nautilus' });
    expect(saved.countsUnder).toBe('c1');
    expect(saved.category).toBe('Scaling');
    expect(saved.bans).toEqual(['Zed']);
    expect(saved.gamePlan).toEqual(comp.gamePlan);
    expect(saved.notes).toBe('Variant from the review of 9 Sep 2026: Nautilus peels Jinx through the dive and still starts a fight.');
    // The expectation is stamped on the way out, as the Comps page stamps every save, and the service's own id and order are not written.
    expect(saved.expect).toEqual(EXPECT);
    expect(saved.expectSource).toBe('derived');
    expect('id' in saved).toBe(false);
    expect('order' in saved).toBe(false);

    const after = root.querySelector('.film-draft-swap .view-btn') as HTMLButtonElement;
    expect(text(after)).toContain('Open Front to back · Nautilus');
    expect(after.classList.contains('active')).toBe(true);
    expect(after.disabled).toBe(false);
    expect(root.querySelectorAll('.film-draft-swap .view-btn')).toHaveLength(1);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    after.click();
    expect(navigate).toHaveBeenCalledWith(['/comps'], { queryParams: { comp: 'c2' } });
    // The toast offers the same door.
    const toast = TestBed.inject(ToastService).toasts()[0];
    expect(toast?.title).toBe('Saved to Comps');
    expect(toast?.text).toBe('Front to back · Nautilus');
    expect(toast?.action?.label).toBe('Open');
    toast?.action?.run();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith(['/comps'], { queryParams: { comp: 'c2' } });
  });

  it('offers Open <name> from the start when the variant is already saved, to a viewer too, with no Save pill', () => {
    // Played off no comp, so the base is the five as played; Top carries Riot's id while the saved comp spells the
    // name, and the saved comp's Support pick carries a note: the match still holds through championName and parseCompLine.
    const played: FilmDraft = {
      ...draft,
      ours: draft.ours.map((s) => (s.seat === 'Top' ? { ...s, champion: 'MonkeyKing' } : s)),
      compId: null,
      compName: null,
      variantName: null
    };
    const variant: Comp = {
      id: 'c5',
      name: 'Wukong front to back',
      picks: { Top: 'Wukong', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Nautilus - peel' },
      order: 1
    };
    data.comps.set([comp, variant]);

    canEdit.set(false);
    const viewer = mount(modelWith(played));
    const viewerRoot = viewer.nativeElement as HTMLElement;
    const pills = viewerRoot.querySelectorAll<HTMLButtonElement>('.film-draft-swap .view-btn');
    expect(pills).toHaveLength(1);
    expect(text(pills[0])).toContain('Open Wukong front to back');
    expect(text(pills[0])).not.toContain('Save');
    expect(pills[0].classList.contains('active')).toBe(true);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    pills[0].click();
    expect(navigate).toHaveBeenCalledWith(['/comps'], { queryParams: { comp: 'c5' } });
    viewer.destroy();

    canEdit.set(true);
    const editorRoot = mount(modelWith(played)).nativeElement as HTMLElement;
    const editorPills = editorRoot.querySelectorAll<HTMLButtonElement>('.film-draft-swap .view-btn');
    expect(editorPills).toHaveLength(1);
    expect(text(editorPills[0])).toContain('Open Wukong front to back');
  });

  it('opens the comp we played from the bottom pill when the review names it', () => {
    canEdit.set(false);
    const root = mount(modelWith(draft)).nativeElement as HTMLElement;
    const pills = root.querySelectorAll<HTMLButtonElement>('.film-draft-actions .view-btn');
    expect(pills).toHaveLength(1);
    expect(text(pills[0])).toContain('Open Front to back');
    expect(text(pills[0])).not.toContain('Open Comps');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    pills[0].click();
    expect(navigate).toHaveBeenCalledWith(['/comps'], { queryParams: { comp: 'c1' } });
  });

  it('lets an editor save the draft as played and open it when the review names no comp, and a variant after that counts under it', async () => {
    // No comp on the list carries these five: were one there, the pill would open it instead (the case below).
    data.comps.set([]);
    const fixture = mount(modelWith({ ...draft, compId: null, compName: null, variantName: 'Jinx comp · Nautilus' }));
    const root = fixture.nativeElement as HTMLElement;
    const bottom = () => root.querySelector('.film-draft-actions .view-btn') as HTMLButtonElement;
    expect(text(bottom())).toContain('Save as a comp and open');
    expect(root.querySelectorAll('.film-draft-actions .view-btn')).toHaveLength(1);
    // `createComp` as the service does it: the new comp is on the list before the promise settles.
    const ids = ['c9', 'c10'];
    const create = vi.spyOn(data, 'createComp').mockImplementation(async (c) => {
      const id = ids.shift() as string;
      data.comps.update((list) => [...list, { ...c, id, order: list.length }]);
      return id;
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    // Twice, as a double click lands: one comp.
    bottom().click();
    bottom().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledTimes(1);
    const made = create.mock.calls[0][0];
    expect(made.name).toBe('Jinx comp');
    expect(made.picks).toEqual({ Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona' });
    expect(made.notes).toBe(`From the review of 9 Sep 2026: ${draft.verdict}`);
    expect(made.expect).toEqual(EXPECT);
    expect(made.countsUnder).toBeUndefined();
    expect(made.category).toBeUndefined();
    expect('id' in made).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/comps'], { queryParams: { comp: 'c9' } });
    expect(text(bottom())).toContain('Open Jinx comp');
    expect(TestBed.inject(ToastService).toasts()[0]?.action?.label).toBe('Open');

    // The swap's variant now counts under the comp just made, with its picks as the base.
    const swapPill = root.querySelector('.film-draft-swap .view-btn') as HTMLButtonElement;
    expect(text(swapPill)).toContain('Save with Nautilus');
    swapPill.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledTimes(2);
    const variant = create.mock.calls[1][0];
    expect(variant.name).toBe('Jinx comp · Nautilus');
    expect(variant.countsUnder).toBe('c9');
    expect(variant.picks).toEqual({ Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Nautilus' });
    expect(text(root.querySelector('.film-draft-swap .view-btn'))).toContain('Open Jinx comp · Nautilus');
  });

  it('opens the saved comp whose five picks are ours as played when the review names none, for editor and viewer, and never offers Save again', async () => {
    // The visit after "Save as a comp and open": the review still says compId null and the chapter is fresh, but the
    // comp is on the list (spelt the Comps way, one pick with a note); the pill finds it by its picks and nothing is made.
    const asPlayed: Comp = {
      id: 'c7',
      name: 'Jinx comp',
      picks: { Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona - peel' },
      order: 1
    };
    data.comps.set([asPlayed]);
    const noComp: FilmDraft = { ...draft, compId: null, compName: null, variantName: 'Jinx comp · Nautilus' };
    const create = vi.spyOn(data, 'createComp').mockResolvedValue('never');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const editor = mount(modelWith(noComp));
    const editorRoot = editor.nativeElement as HTMLElement;
    const pills = editorRoot.querySelectorAll<HTMLButtonElement>('.film-draft-actions .view-btn');
    expect(pills).toHaveLength(1);
    expect(text(pills[0])).toContain('Open Jinx comp');
    expect(text(pills[0])).not.toContain('Save');
    pills[0].click();
    expect(navigate).toHaveBeenCalledWith(['/comps'], { queryParams: { comp: 'c7' } });
    // The swap's variant counts under the comp found by its picks, as it would under one the review named.
    (editorRoot.querySelector('.film-draft-swap .view-btn') as HTMLButtonElement).click();
    await editor.whenStable();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].countsUnder).toBe('c7');
    expect(create.mock.calls[0][0].name).toBe('Jinx comp · Nautilus');
    editor.destroy();

    canEdit.set(false);
    const viewerRoot = mount(modelWith(noComp)).nativeElement as HTMLElement;
    const viewerPills = viewerRoot.querySelectorAll<HTMLButtonElement>('.film-draft-actions .view-btn');
    expect(viewerPills).toHaveLength(1);
    expect(text(viewerPills[0])).toContain('Open Jinx comp');
    expect(text(viewerPills[0])).not.toContain('Open Comps');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('shows no bottom pill while the review names a comp the list has not delivered, then opens it when the list lands', () => {
    data.comps.set([]);
    const fixture = mount(modelWith(draft));
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.film-draft-actions')).toBeNull();
    data.comps.set([comp]);
    fixture.detectChanges();
    expect(text(root.querySelector('.film-draft-actions .view-btn'))).toContain('Open Front to back');
    // The list is here and lacks the comp: it was deleted, and an editor may save the draft as played again.
    data.comps.set([{ ...comp, id: 'other', picks: { ...comp.picks, Top: 'Sion' } }]);
    fixture.detectChanges();
    expect(text(root.querySelector('.film-draft-actions .view-btn'))).toContain('Save as a comp and open');
  });

  it('sends a viewer to the Comps page when the review names no comp and no saved comp carries the five as played', () => {
    canEdit.set(false);
    data.comps.set([]);
    const root = mount(modelWith({ ...draft, compId: null, compName: null })).nativeElement as HTMLElement;
    expect(root.querySelector('.film-draft-swap .view-btn')).toBeNull();
    const pills = root.querySelectorAll<HTMLButtonElement>('.film-draft-actions .view-btn');
    expect(pills).toHaveLength(1);
    expect(text(pills[0])).toContain('Open Comps');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    pills[0].click();
    expect(navigate).toHaveBeenCalledWith(['/comps']);
  });

  it('names the second of two swaps off its own champion alone, with only its seat changed', async () => {
    const two: FilmDraft = {
      ...draft,
      swaps: [...draft.swaps, { seat: 'Jungle', out: 'Trundle', in: 'Sejuani', why: 'A frontline that starts the fight.', gains: ['frontline', 'engage'], glyphs: ['wall', 'fist'] }],
      variantName: 'Front to back · Nautilus'
    };
    const fixture = mount(modelWith(two));
    const root = fixture.nativeElement as HTMLElement;
    const pills = root.querySelectorAll<HTMLButtonElement>('.film-draft-swap .view-btn');
    expect(pills).toHaveLength(2);
    expect(text(pills[0])).toContain('Save with Nautilus');
    expect(text(pills[1])).toContain('Save with Sejuani');
    const create = vi.spyOn(data, 'createComp').mockResolvedValue('c4');
    pills[1].click();
    await fixture.whenStable();
    fixture.detectChanges();
    const saved = create.mock.calls[0][0];
    expect(saved.name).toBe('Front to back · Sejuani');
    expect(saved.name).not.toContain('Nautilus');
    expect(saved.picks).toEqual({ Top: 'Ornn', Jungle: 'Sejuani', Mid: 'Orianna', ADC: 'Jinx', Support: 'Leona' });
    expect(saved.countsUnder).toBe('c1');
    expect(TestBed.inject(ToastService).toasts()[0]?.text).toBe('Front to back · Sejuani');
    // Only the swap saved opens its variant; the first is still on offer, and the first swap's variant keeps the build's name.
    const after = root.querySelectorAll<HTMLButtonElement>('.film-draft-swap .view-btn');
    expect(text(after[0])).toContain('Save with Nautilus');
    expect(after[0].disabled).toBe(false);
    expect(text(after[1])).toContain('Open Front to back · Sejuani');
    expect(after[1].disabled).toBe(false);
    after[0].click();
    await fixture.whenStable();
    expect(create.mock.calls[1][0].name).toBe(two.variantName);
  });

  it('builds a comp of its own when the game was played off no saved comp, named off the protagonist and the swap', async () => {
    data.comps.set([]);
    const fixture = mount(modelWith({ ...draft, compId: null, compName: null, variantName: 'Jinx comp · Nautilus' }));
    const root = fixture.nativeElement as HTMLElement;
    const create = vi.spyOn(data, 'createComp').mockResolvedValue('c3');
    (root.querySelector('.film-draft-swap .view-btn') as HTMLButtonElement).click();
    await fixture.whenStable();
    const saved = create.mock.calls[0][0];
    expect(saved.name).toBe('Jinx comp · Nautilus');
    expect(saved.picks).toEqual({ Top: 'Ornn', Jungle: 'Trundle', Mid: 'Orianna', ADC: 'Jinx', Support: 'Nautilus' });
    expect(saved.countsUnder).toBeUndefined();
    expect(saved.expect).toEqual(EXPECT);
  });

  it('keeps the tiles turned when the model is rebuilt around the same swaps', () => {
    // Motion on, so the turn is a timer that a restart would reset; the timers are faked so the spec can run it down.
    localStorage.setItem('bom-motion', 'on');
    vi.useFakeTimers();
    try {
      const fixture = mount(modelWith(draft));
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.film-draft-seat.is-swapped')).toBeNull();
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(root.querySelector('.film-draft-seat.is-swapped')).not.toBeNull();
      // A fresh model object with the same swaps: another review landing, a teammate saving a note. The tile stays turned.
      fixture.componentRef.setInput('model', modelWith({ ...draft, swaps: draft.swaps.map((s) => ({ ...s })) }));
      fixture.detectChanges();
      expect(root.querySelector('.film-draft-seat.is-swapped')).not.toBeNull();
      // A different swap is a new turn.
      fixture.componentRef.setInput('model', modelWith({ ...draft, swaps: [{ ...draft.swaps[0], in: 'Braum' }] }));
      fixture.detectChanges();
      expect(root.querySelector('.film-draft-seat.is-swapped')).toBeNull();
      vi.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(root.querySelector('.film-draft-seat.is-swapped')).not.toBeNull();
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says the draft held when there are no swaps, over the protagonist dimmed, with no Save pills', () => {
    const root = mount(modelWith({ ...draft, swaps: [] })).nativeElement as HTMLElement;
    // The pill's icon is a Material ligature, so its name sits in the text too.
    expect(text(root.querySelector('.film-draft-held'))).toContain('The draft held.');
    expect(root.querySelectorAll('.film-draft-swap')).toHaveLength(0);
    expect(root.querySelector('.film-draft-swap .view-btn')).toBeNull();
    expect(root.querySelectorAll('.film-draft-row.is-ours .film-draft-seat')).toHaveLength(5);
    const art = root.querySelector('.film-chapter-art') as HTMLElement;
    expect(art.classList.contains('is-dim')).toBe(true);
    expect(art.querySelector('img')?.getAttribute('src')).toContain('jinx');
    // The review names the comp we played, so the one pill opens it.
    expect(text(root.querySelector('.film-draft-actions .view-btn'))).toContain('Open Front to back');
  });

  it('says so when the review carries no draft at all', () => {
    const root = mount(modelWith(undefined)).nativeElement as HTMLElement;
    expect(text(root.querySelector('.film-wait'))).toBe('The review carries no draft verdict for this game.');
    expect(root.querySelector('.film-draft-rows')).toBeNull();
  });

  it('shows what the comp lacked as chips over the swaps, each why as the tip and as a line under, and the other options under each swap that has them (review version 6)', () => {
    const v6: FilmDraft = {
      ...draft,
      swaps: [
        { ...draft.swaps[0], alternatives: ['Braum', 'Alistar'] },
        { seat: 'Jungle', out: 'Trundle', in: 'Sejuani', why: 'A frontline that starts the fight.', gains: ['frontline', 'engage'], glyphs: ['wall', 'fist'], alternatives: ['Zac'] },
        { seat: 'Mid', out: 'Orianna', in: 'Syndra', why: 'Damage from range while the front holds.', gains: ['damage'], glyphs: ['bolt'] }
      ],
      lacked: [
        { gain: 'frontline', glyph: 'wall', why: 'Ornn was the only tank and died first in every fight from 14.' },
        { gain: 'peel', glyph: 'shield', why: 'Jinx had no one between her and the dive.' },
        // A gap the build kept without a sentence: the chip stands, with no tip and no line under it.
        { gain: 'engage', glyph: 'fist', why: '' }
      ]
    };
    const fixture = mount(modelWith(v6));
    const root = fixture.nativeElement as HTMLElement;
    const block = root.querySelector('.film-draft-lacked-block') as HTMLElement;
    expect(block).not.toBeNull();
    expect(text(block.querySelector('.film-draft-lacked-label'))).toBe('What the five lacked');
    const chips = Array.from(block.querySelectorAll('.film-draft-lacked .film-draft-gap'));
    expect(chips.map((c) => text(c))).toEqual(['Frontline', 'Peel', 'Engage']);
    expect(chips.map((c) => c.querySelector('svg')?.getAttribute('data-glyph'))).toEqual(['wall', 'shield', 'fist']);
    expect(fixture.debugElement.queryAll(By.css('.film-draft-gap')).map((de) => de.injector.get(TooltipDirective).appTip())).toEqual([v6.lacked![0].why, v6.lacked![1].why, '']);
    expect(Array.from(block.querySelectorAll('.film-draft-lacked-why')).map((li) => text(li))).toEqual([v6.lacked![0].why, v6.lacked![1].why]);
    // Over the swaps, in the same column of the layout.
    const swaps = root.querySelector('.film-draft-swaps') as HTMLElement;
    expect(block.compareDocumentPosition(swaps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.parentElement).toBe(swaps.parentElement);
    expect(block.parentElement?.classList.contains('film-draft-side')).toBe(true);
    expect(root.querySelector('.film-draft-held')).toBeNull();

    // Three swaps: three cards, three seats turned, a Save pill each.
    const cards = root.querySelectorAll('.film-draft-swap');
    expect(cards).toHaveLength(3);
    expect(root.querySelectorAll('.film-draft-seat.has-swap.is-swapped')).toHaveLength(3);
    const pills = Array.from(root.querySelectorAll('.film-draft-swap .view-btn')).map((b) => text(b));
    expect(pills).toHaveLength(3);
    expect(pills[0]).toContain('Save with Nautilus');
    expect(pills[1]).toContain('Save with Sejuani');
    expect(pills[2]).toContain('Save with Syndra');

    // The other options under the champion to try, a tile each; the swap that names none carries no line.
    const alt = cards[0].querySelector('.film-draft-swap-side.is-in .film-draft-alt') as HTMLElement;
    expect(text(alt)).toBe('or Braum, or Alistar');
    expect(Array.from(alt.querySelectorAll('img.film-draft-alt-tile')).map((i) => i.getAttribute('src')?.split('/').pop())).toEqual(['Braum.png', 'Alistar.png']);
    expect(text(cards[1].querySelector('.film-draft-alt'))).toBe('or Zac');
    expect(cards[2].querySelector('.film-draft-alt')).toBeNull();
    // The champion to try still stands on its own line, so the card's pair reads as before.
    expect(text(cards[0].querySelector('.film-draft-swap-side.is-in .film-draft-champ'))).toBe('Nautilus');
  });

  it('shows no gaps and no other options for a version 5 review, and says the draft held only when the review names neither a swap nor a gap', () => {
    const root = mount(modelWith(draft)).nativeElement as HTMLElement;
    expect(root.querySelector('.film-draft-lacked-block')).toBeNull();
    expect(root.querySelector('.film-draft-alt')).toBeNull();
    expect(root.querySelector('.film-draft-side .film-draft-swaps')).not.toBeNull();
    // The draft held: nothing on the right at all.
    const held = mount(modelWith({ ...draft, swaps: [] })).nativeElement as HTMLElement;
    expect(held.querySelector('.film-draft-side')).toBeNull();
    expect(held.querySelector('.film-draft-held')).not.toBeNull();
    // No swap the review could name (no champion list was offered), but the five lacked something: the chips stand and "The draft held." does not.
    const lacking = mount(modelWith({ ...draft, swaps: [], lacked: [{ gain: 'engage', glyph: 'fist', why: 'Nobody could start the fight.' }] })).nativeElement as HTMLElement;
    expect(lacking.querySelector('.film-draft-held')).toBeNull();
    expect(Array.from(lacking.querySelectorAll('.film-draft-gap')).map((c) => text(c))).toEqual(['Engage']);
    expect(lacking.querySelector('.film-draft-swaps')).toBeNull();
  });
});
