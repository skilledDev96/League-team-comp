import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilmCommitment, FilmProgress, GameReview, UserPrefs } from '../models/team.models';
import { TeamDataService } from '../services/team-data.service';
import { UserPrefsService } from '../services/user-prefs.service';
import { BeforeYouPlayComponent } from './before-you-play.component';

/**
 * The card reads two services and writes one: the reviews and the
 * commitments from the team's data, the reminders from this person's prefs.
 * Both are stubbed here, so the card is tested against what they say and
 * not against a backend; the environment keeps its key, because the card
 * shows nothing at all without one.
 */

const V5 = 'EUW1_5';
const V3 = 'EUW1_3';
const EMPTY = 'EUW1_0';
/** Long past, so the reminder is due whatever the clock says. */
const overdue = '2020-01-01T00:00:00.000Z';
const done = '2019-12-31T00:00:00.000Z';

const point = (text: string) => ({ text, evidence: '', minute: null });

const reviews: Record<string, GameReview> = {
  [V5]: {
    matchId: V5,
    team: {
      headline: 'Bled 35 kills while farming even',
      summary: 'The team matched on CS but gave up the fights.',
      workOn: [
        point('Jinx died three times before ten; either play safer trades or ask for jungle pressure earlier.'),
        point('Nobody warded the river before the 20-minute dragon; either a control ward at 18 or the jungler paths there.')
      ],
      keepDoing: [],
      oneThing: 'Play safer trades or ask for jungle pressure earlier.',
      // The lessons stay on the review; since 10 Sep 2026 the card reads none of them.
      lessons: [
        { question: 'How many early deaths had no ward nearby?', options: ['One', 'Two', 'Three'], answer: 2, why: 'Three, minutes 4 to 9.' },
        { question: 'Whose dragon at 20?', options: ['Ours', 'Theirs', 'Nobody'], answer: 1, why: 'Their infernal, uncontested.' }
      ]
    },
    players: [
      {
        name: 'Rhu',
        seat: 'ADC',
        champion: 'Jinx',
        strength: point(''),
        workOn: point('Died early, so hold the wave under tower.'),
        more: [{ ...point('Flashed forward into three at 14; keep Flash for the way out.'), theme: 'fights' }]
      }
    ]
  } as unknown as GameReview,
  [V3]: {
    matchId: V3,
    team: { summary: 'Lost the map after twenty. Nothing else.', workOn: [point('The jungler was never on the bot side; path bot after the first clear.')], keepDoing: [] },
    players: []
  } as unknown as GameReview,
  [EMPTY]: { matchId: EMPTY, team: { summary: '', workOn: [], keepDoing: [] }, players: [] } as unknown as GameReview
};

const commitments: Record<string, FilmCommitment> = {
  [V5]: { matchId: V5, text: 'Either play safer trades or ask for jungle pressure earlier.', options: ['Play safer trades', 'Ask for jungle pressure earlier'], by: { a: 'b', b: 'b', c: 'a' } }
};

describe('BeforeYouPlayComponent', () => {
  const prefs = signal<UserPrefs>({});
  const saved: { matchId: string; patch: Partial<FilmProgress> }[] = [];
  const prefsStub = {
    prefs,
    filmProgress: (id: string) => prefs().film?.films?.[id],
    filmSeat: () => prefs().film?.seat,
    // The real service's merge, in miniature: an undefined field is a delete.
    saveFilmProgress: vi.fn(async (id: string, patch: Partial<FilmProgress>) => {
      saved.push({ matchId: id, patch });
      const film = prefs().film ?? {};
      const current = { ...(film.films?.[id] ?? {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete current[k];
        else current[k] = v;
      }
      prefs.set({ ...prefs(), film: { ...film, films: { ...(film.films ?? {}), [id]: current as FilmProgress } } });
    })
  };
  const dataStub = {
    reviewFor: (id: string | undefined) => (id ? reviews[id] : undefined),
    commitmentFor: (id: string | undefined) => (id ? commitments[id] : undefined)
  };

  beforeEach(() => {
    saved.length = 0;
    prefs.set({});
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: TeamDataService, useValue: dataStub }, { provide: UserPrefsService, useValue: prefsStub }]
    });
  });

  function mount() {
    const fixture = TestBed.createComponent(BeforeYouPlayComponent);
    fixture.detectChanges();
    return fixture;
  }

  const lines = (el: HTMLElement) => Array.from(el.querySelectorAll('.byp-line')).map((li) => [li.className.replace('byp-line', '').trim(), li.textContent?.trim()]);

  it('reminds of the one thing, the commitment, your own ask and two further asks for a version 5 film, and Got it climbs the ladder', async () => {
    prefs.set({ film: { seat: 'ADC', films: { [V5]: { done, nextAskAt: overdue, asked: 0 } } } });
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.byp-kicker')?.textContent).toContain('Before you play');
    expect(el.querySelector('.byp-film')?.textContent?.trim()).toBe('Bled 35 kills while farming even');
    expect(lines(el)).toEqual([
      ['is-one', 'Play safer trades or ask for jungle pressure earlier.'],
      ['is-commit', 'Ask for jungle pressure earlier'],
      ['is-ask', 'Hold the wave under tower.'],
      ['is-more', 'Either a control ward at 18 or the jungler paths there.'],
      ['is-more', 'Keep Flash for the way out.']
    ]);
    // Each line carries the film's glyph (the further asks a smaller flag, labelled Also), and nothing on the card is a question, a verdict or a lesson's answer.
    expect(el.querySelectorAll('.byp-line .film-glyph').length).toBe(5);
    expect(el.querySelectorAll('.byp-line.is-more .film-glyph[data-glyph="flag"][aria-label="Also"]').length).toBe(2);
    expect(el.textContent).not.toMatch(/Called it|Not this time|Which|\?|minutes 4 to 9|infernal/);
    const pills = Array.from(el.querySelectorAll('.byp-actions .view-btn')).map((b) => b.textContent?.trim());
    expect(pills).toEqual(['check Got it', 'movie Open the card']);
    expect(el.querySelector('.byp-actions .view-btn.active')?.textContent).toContain('Got it');
    expect(el.querySelector('.byp-actions a')).toBeNull();

    (el.querySelector('.byp-actions .view-btn.active') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(saved.length).toBe(1);
    expect(saved[0].matchId).toBe(V5);
    expect(saved[0].patch.asked).toBe(1);
    // Three days on from now, never from the long-past finish: the card is gone until then.
    expect(Date.parse(saved[0].patch.nextAskAt!)).toBeGreaterThan(Date.now());
    expect(el.querySelector('.before-you-play')).toBeNull();
  });

  it('renders the first work-on as the one ask for a version 3 film, with the summary\'s first sentence over it', () => {
    prefs.set({ film: { films: { [V3]: { done, nextAskAt: overdue, asked: 1 } } } });
    const el = mount().nativeElement as HTMLElement;
    expect(el.querySelector('.byp-film')?.textContent?.trim()).toBe('Lost the map after twenty.');
    expect(lines(el)).toEqual([['is-one', 'Path bot after the first clear.']]);
    expect(saved).toEqual([]);
  });

  it('shows nothing when nothing is due, and switches off a due film with nothing to remind of so the next one gets its turn', async () => {
    prefs.set({ film: { films: { [V5]: { done, asked: 3 } } } });
    let fixture = mount();
    expect((fixture.nativeElement as HTMLElement).querySelector('.before-you-play')).toBeNull();
    fixture.destroy();

    prefs.set({ film: { films: { [EMPTY]: { done, nextAskAt: overdue, asked: 0 }, [V3]: { done, nextAskAt: '2020-01-02T00:00:00.000Z', asked: 0 } } } });
    fixture = mount();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(saved).toEqual([{ matchId: EMPTY, patch: { nextAskAt: undefined } }]);
    expect(lines(el)).toEqual([['is-one', 'Path bot after the first clear.']]);
  });

  it('drops the headline and the card chrome when compact, and Open the card routes to the film\'s card', () => {
    prefs.set({ film: { films: { [V5]: { done, nextAskAt: overdue, asked: 0 } } } });
    const fixture = TestBed.createComponent(BeforeYouPlayComponent);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.before-you-play')?.classList.contains('is-compact')).toBe(true);
    expect(el.querySelector('.before-you-play')?.classList.contains('card')).toBe(false);
    expect(el.querySelector('.byp-film')).toBeNull();
    // No seat said: no own ask on the card, and no further point of the viewer's own; the team's second work-on still comes.
    expect(lines(el).map(([k]) => k)).toEqual(['is-one', 'is-commit', 'is-more']);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (Array.from(el.querySelectorAll('.byp-actions .view-btn')).find((b) => b.textContent?.includes('Open the card')) as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/film', V5], { queryParams: { c: 'card' } });
  });
});
