import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmDraft, FilmModel } from '../../../core/film-model';
import { Comp, CompExpectation } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { CompExpectationService } from '../../../services/comp-expectation.service';
import { TeamDataService } from '../../../services/team-data.service';
import { ToastService } from '../../../services/toast.service';
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

  it('shows the Save pill to editors only, and saves a variant of the comp we played', async () => {
    canEdit.set(false);
    const viewer = mount(modelWith(draft));
    const viewerRoot = viewer.nativeElement as HTMLElement;
    expect(viewerRoot.querySelector('.film-draft-swap .view-btn')).toBeNull();
    expect(text(viewerRoot.querySelector('.film-draft-actions .view-btn'))).toContain('Open Comps');
    viewer.destroy();

    canEdit.set(true);
    const fixture = mount(modelWith(draft));
    const root = fixture.nativeElement as HTMLElement;
    const pill = root.querySelector('.film-draft-swap .view-btn') as HTMLButtonElement;
    expect(text(pill)).toContain('Save with Nautilus');
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
    expect(text(after)).toContain('Saved');
    expect(after.disabled).toBe(true);
    expect(TestBed.inject(ToastService).toasts()[0]?.title).toBe('Saved to Comps');
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
    // Only the swap saved reads Saved; the first is still on offer, and the first swap's variant keeps the build's name.
    const after = root.querySelectorAll<HTMLButtonElement>('.film-draft-swap .view-btn');
    expect(after[0].disabled).toBe(false);
    expect(after[1].disabled).toBe(true);
    after[0].click();
    await fixture.whenStable();
    expect(create.mock.calls[1][0].name).toBe(two.variantName);
  });

  it('builds a comp of its own when the game was played off no saved comp, named off the protagonist and the swap', async () => {
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
    expect(text(root.querySelector('.film-draft-actions .view-btn'))).toContain('Open Comps');
  });

  it('says so when the review carries no draft at all', () => {
    const root = mount(modelWith(undefined)).nativeElement as HTMLElement;
    expect(text(root.querySelector('.film-wait'))).toBe('The review carries no draft verdict for this game.');
    expect(root.querySelector('.film-draft-rows')).toBeNull();
  });
});
