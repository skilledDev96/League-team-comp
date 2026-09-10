import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RowPlayer } from '../pages/games/game-rows';
import { UiService } from '../services/ui.service';
import { GameGraphsComponent } from './game-graphs.component';

// The graphs only ask the UI service for a champion icon; a stub keeps the spec
// off the champion index, which fetches on construction.
const uiStub = { championIconUrl: (champion: string) => `icon/${champion}.png` };

const ours: RowPlayer[] = [
  { role: 'Top', champion: 'Aatrox', player: 'Zac', stats: { kills: 6, deaths: 3, assists: 4, cs: 240, damage: 18_000, killParticipation: 0.5 } },
  { role: 'Jungle', champion: 'Vi', player: 'Go10x', stats: { kills: 4, deaths: 2, assists: 10, cs: 180, damage: 12_000, killParticipation: 0.7 } }
];

// Their figures, as a Riot game refreshed on or after 10 Sep 2026 carries them:
// the top laner out-damaged everyone, the jungler's seat came without figures.
const theirs: RowPlayer[] = [
  { role: 'Top', champion: 'Renekton', player: null, stats: { kills: 9, deaths: 2, assists: 3, cs: 250, damage: 52_500 } },
  { role: 'Jungle', champion: 'Lee Sin', player: null }
];

describe('GameGraphsComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: UiService, useValue: uiStub }] });
  });

  function mount(inputs: { ours: RowPlayer[]; theirs?: RowPlayer[] }) {
    const fixture = TestBed.createComponent(GameGraphsComponent);
    fixture.componentRef.setInput('ours', inputs.ours);
    if (inputs.theirs) fixture.componentRef.setInput('theirs', inputs.theirs);
    fixture.detectChanges();
    return fixture;
  }

  const widths = (el: HTMLElement, side: 'ours' | 'theirs') =>
    [...el.querySelectorAll<HTMLElement>(`.game-graphs-bar${side === 'theirs' ? '.is-theirs' : ':not(.is-theirs)'} .game-graphs-fill`)].map((f) =>
      parseFloat(f.style.width)
    );
  const labels = (el: HTMLElement, side: 'ours' | 'theirs') =>
    [...el.querySelectorAll<HTMLElement>(`.game-graphs-bar${side === 'theirs' ? '.is-theirs' : ':not(.is-theirs)'} .value`)].map((v) => v.textContent?.trim());

  it('scales both sides against one longest bar, so their 52.5k fills the track and ours sits at its share', () => {
    const el = mount({ ours, theirs }).nativeElement as HTMLElement;
    expect(widths(el, 'theirs')[0]).toBe(100);
    expect(widths(el, 'ours')[0]).toBeCloseTo((18_000 / 52_500) * 100, 5);
    expect(widths(el, 'ours')[1]).toBeCloseTo((12_000 / 52_500) * 100, 5);
    expect(labels(el, 'theirs')[0]).toBe('52.5k');
    expect(labels(el, 'ours')).toEqual(['18.0k', '12.0k']);
  });

  it('draws a dash and an empty track for a seat without the figure, and pairs the sides seat by seat', () => {
    const el = mount({ ours, theirs }).nativeElement as HTMLElement;
    const pairs = el.querySelectorAll('.game-graphs-pair');
    expect(pairs.length).toBe(2);
    expect(pairs[1].querySelectorAll('.game-graphs-bar').length).toBe(2);
    expect(labels(el, 'theirs')[1]).toBe('—');
    expect(widths(el, 'theirs')[1]).toBe(0);
    expect(el.querySelectorAll('.game-graphs-bar.is-theirs .game-graphs-fill.is-none').length).toBe(1);
  });

  it('offers kills plus assists for both sides and never a kill share, whose team total is not on the row', () => {
    const fixture = mount({ ours, theirs });
    const el = fixture.nativeElement as HTMLElement;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.view-segment button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Damage dealt', 'CS', 'Kills + assists']);
    buttons.find((b) => b.textContent?.trim() === 'Kills + assists')!.click();
    fixture.detectChanges();
    expect(labels(el, 'ours')).toEqual(['10', '14']);
    expect(labels(el, 'theirs')).toEqual(['12', '—']);
    expect(widths(el, 'ours')[1]).toBe(100);
  });

  it('keeps the note on the colours and the dash, and says where damage taken goes when both are shown', () => {
    const fixture = mount({
      ours: [{ ...ours[0], stats: { ...ours[0].stats!, damageTaken: 20_000 } }],
      theirs: [{ ...theirs[0], stats: { ...theirs[0].stats!, damageTaken: 30_000 } }]
    });
    const el = fixture.nativeElement as HTMLElement;
    const legend = () => el.querySelector('.game-graphs-legend')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(legend()).toBe('Ours in colour, theirs in grey. A dash means the game did not carry the figure.');
    [...el.querySelectorAll<HTMLButtonElement>('.view-segment button')].find((b) => b.textContent?.trim() === 'Dealt vs taken')!.click();
    fixture.detectChanges();
    expect(legend()).toBe('Ours in colour, theirs in grey; damage taken in amber under damage dealt. A dash means the game did not carry the figure.');
    // Dealt against taken share one longest bar too: their 52.5k dealt is the whole track.
    expect(widths(el, 'theirs')).toEqual([100, expect.closeTo((30_000 / 52_500) * 100, 5)]);
  });
});
