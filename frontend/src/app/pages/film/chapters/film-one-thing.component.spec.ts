import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../../environments/environment';
import { FilmModel } from '../../../core/film-model';
import { FilmChoice, FilmCommitment } from '../../../models/team.models';
import { AuthService } from '../../../services/auth.service';
import { TeamDataService } from '../../../services/team-data.service';
import { FilmOneThingComponent } from './film-one-thing.component';

// Local mode, the way the film page's spec does it: no listeners, no backend, and an editor.
const realApiKey = environment.firebase.apiKey;
environment.firebase.apiKey = '';
afterAll(() => {
  environment.firebase.apiKey = realApiKey;
});

const ID = 'EUW1_7000000004';

/** The sentence the team picked on, and the one the re-review of 17 Sep 2026 wrote over it. */
const OLD = 'Jinx walked into five alone at 22; either reset until all five are up or hold for the Baron timer.';
const OLD_OPTIONS: [string, string] = ['Reset until all five are up', 'Hold for the Baron timer'];
const NEW = 'Jinx engaged into four at 22; either engage only with Aphelios in range or reset until all five are up.';
const NEW_OPTIONS: [string, string] = ['Engage only with Aphelios in range', 'Reset until all five are up'];

const model = {
  matchId: ID,
  tier: 'timeline',
  seed: 7,
  seats: [],
  title: { headline: 'Bled 35 kills while farming even', win: false, protagonist: { seat: 'ADC', champion: 'Jinx', name: 'Rhu' } },
  oneThing: { point: { text: NEW, evidence: 'kills 14-35', minute: 22, theme: 'fights' }, options: NEW_OPTIONS, rest: [] }
} as unknown as FilmModel;

const committed = (text: string, options: [string, string], by: Record<string, FilmChoice>): FilmCommitment => ({ matchId: ID, text, options, by });

function text(el: Element | null): string {
  const copy = el?.cloneNode(true) as Element | undefined;
  copy?.querySelectorAll('.material-symbols-rounded').forEach((i) => i.remove());
  return (copy?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// The chapter renders under TestBed, which needs the DOM only the Angular runner (ng test, jsdom) provides.
describe.skipIf(typeof localStorage === 'undefined')('FilmOneThingComponent', () => {
  let data: TeamDataService;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('bom-motion', 'off');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    data = TestBed.inject(TeamDataService);
  });

  function mount(ownChoice?: FilmChoice) {
    const fixture = TestBed.createComponent(FilmOneThingComponent);
    fixture.componentRef.setInput('model', model);
    if (ownChoice) fixture.componentRef.setInput('ownChoice', ownChoice);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, root, lines: () => Array.from(root.querySelectorAll('.film-commit-line')).map(text) };
  }

  it('asks again after a re-review: no team mark or initials on the new cards, and one line with the sentence the team had committed on', () => {
    data.filmCommitments.set([committed(OLD, OLD_OPTIONS, { 'rhu@bom.gg': 'a', 'kez@bom.gg': 'a' })]);
    const { fixture, root, lines } = mount();
    expect(Array.from(root.querySelectorAll('.film-commit-text')).map(text)).toEqual(NEW_OPTIONS);
    expect(root.querySelector('.film-commit-card.is-team')).toBeNull();
    expect(root.querySelector('.film-commit-card.is-mine')).toBeNull();
    expect(root.querySelector('.film-commit-cards.has-pick')).toBeNull();
    expect(root.querySelectorAll('.film-commit-cards .film-initial')).toHaveLength(0);
    // The old sentence, not the old A: "Reset until all five are up" is also the new B, and would read as a pick already made.
    expect(lines()).toEqual([`Before the re-review the team committed to: ${OLD}`]);

    // Local mode is an editor: the pick goes through commitTo, which starts the document over on the new sentence.
    root.querySelector<HTMLButtonElement>('.film-commit-card')!.click();
    fixture.detectChanges();
    expect(data.commitmentFor(ID)).toEqual({ matchId: ID, text: NEW, options: NEW_OPTIONS, by: { unknown: 'a' } });
    expect(root.querySelector('.film-commit-card.is-mine.is-team')).not.toBeNull();
    expect(Array.from(root.querySelectorAll('.film-commit-cards .film-initial')).map(text)).toEqual(['UN']);
    expect(lines()).toEqual(['The team committed to A.']);
  });

  it('says nothing of a stale document nobody had picked on', () => {
    data.filmCommitments.set([committed(OLD, OLD_OPTIONS, {})]);
    const { lines } = mount();
    expect(lines()).toEqual([]);
  });

  it('keeps the team mark and the initials while the stored sentence differs only by case or spacing, and a pick keeps everyone else\'s', () => {
    const cased = `  ${NEW.toUpperCase().replace(/ /g, '  ')} `;
    data.filmCommitments.set([committed(cased, NEW_OPTIONS, { 'rhu@bom.gg': 'b', 'kez@bom.gg': 'b' })]);
    const { fixture, root, lines } = mount();
    expect(root.querySelectorAll('.film-commit-card')[1].classList.contains('is-team')).toBe(true);
    expect(root.querySelectorAll('.film-commit-cards .film-initial')).toHaveLength(2);
    expect(lines()).toEqual(['The team committed to B.']);

    // commitTo compares the sentence exactly; the chapter hands it the stored one, so the picks it showed as standing stand.
    root.querySelector<HTMLButtonElement>('.film-commit-card')!.click();
    fixture.detectChanges();
    expect(data.commitmentFor(ID)).toEqual({ matchId: ID, text: cased, options: NEW_OPTIONS, by: { 'rhu@bom.gg': 'b', 'kez@bom.gg': 'b', unknown: 'a' } });
    expect(Array.from(root.querySelectorAll('.film-commit-cards .film-initial')).map(text)).toEqual(['UN', 'RH', 'KE']);
    expect(lines()).toEqual(['The team committed to B.']);
  });

  it('shows a viewer the pick they saved, and it survives the chapter being built again while the team\'s is stale', () => {
    Object.assign(TestBed.inject(AuthService), { canEdit: signal(false) });
    data.filmCommitments.set([committed(OLD, OLD_OPTIONS, { 'rhu@bom.gg': 'a' })]);
    const first = mount('a');
    // The page saves a viewer's pick to their progress and feeds it back as ownChoice.
    const chosen: FilmChoice[] = [];
    first.fixture.componentInstance.chosen.subscribe((c) => {
      chosen.push(c);
      first.fixture.componentRef.setInput('ownChoice', c);
    });
    expect(first.root.querySelectorAll('.film-commit-card')[0].classList.contains('is-mine')).toBe(true);
    expect(first.lines()).toEqual([`Before the re-review the team committed to: ${OLD}`, "Your pick is in; the team's stands once an editor picks."]);

    first.root.querySelectorAll<HTMLButtonElement>('.film-commit-card')[1].click();
    first.fixture.detectChanges();
    expect(chosen).toEqual(['b']);
    expect(first.root.querySelectorAll('.film-commit-card')[1].classList.contains('is-mine')).toBe(true);
    // A viewer never writes the team's document, so the old one stays stale.
    expect(data.commitmentFor(ID)?.text).toBe(OLD);
    first.fixture.destroy();

    // The desktop deck builds only the current chapter: moving away and back, or a reload, mounts a new one.
    const again = mount('b');
    const card = again.root.querySelectorAll('.film-commit-card')[1];
    expect(card.classList.contains('is-mine')).toBe(true);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(again.root.querySelector('.film-commit-cards.has-pick')).not.toBeNull();
    expect(again.lines()).toEqual([`Before the re-review the team committed to: ${OLD}`, "Your pick is in; the team's stands once an editor picks."]);
  });

  it('shows a viewer their stored pick when the team has no commitment to judge it by', () => {
    Object.assign(TestBed.inject(AuthService), { canEdit: signal(false) });
    const { root, lines } = mount('b');
    expect(root.querySelectorAll('.film-commit-card')[1].classList.contains('is-mine')).toBe(true);
    expect(lines()).toEqual(["Your pick is in; the team's stands once an editor picks."]);
  });
});