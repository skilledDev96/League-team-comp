import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FilmDeathPin, FilmTapeEvent } from '../../core/film-model';
import { capTokens, MAX_TOKENS, objectiveIcon, RiftMapComponent, RiftToken } from './rift-map.component';

const events: FilmTapeEvent[] = [
  { sec: 95, kind: 'back', label: 'Top backed', side: 'us', seat: 'Top', x: 8, y: 92 },
  { sec: 200, kind: 'first', label: 'First blood, theirs', side: 'them', x: 40, y: 60 },
  { sec: 210, kind: 'ourDeath', label: 'Rhu (ADC) died', side: 'us', seat: 'ADC', champion: 'Jinx', x: 85, y: 84, key: 'd:3:ADC' },
  { sec: 480, kind: 'objective', label: 'Their dragon (infernal)', side: 'them', x: 69, y: 69 },
  { sec: 900, kind: 'plate', label: 'A plate, ours, bot', side: 'us', x: 80, y: 88 },
  { sec: 1500, kind: 'objective', label: 'Our baron', side: 'us', x: 31, y: 30 }
];

const pins: FilmDeathPin[] = [
  { key: 'd:3:ADC', sec: 210, minute: 3, seat: 'ADC', name: 'Rhu', champion: 'Jinx', zone: 'bot', x: 85, y: 84, how: 'solo', could: ['ward', 'position'], line: 'Rhu (ADC) died at 3 min, alone, in the dark' } as unknown as FilmDeathPin,
  { key: 'd:14:Top', sec: 840, minute: 14, seat: 'Top', champion: 'Ornn', zone: 'river', x: 30, y: 30, how: 'fight', could: ['jungle'], line: 'Ornn died at 14 min in a fight at Baron' } as unknown as FilmDeathPin
];

describe('objectiveIcon', () => {
  it('reads the kind off the tape label', () => {
    expect(objectiveIcon('Their dragon (infernal)')).toBe('pets');
    expect(objectiveIcon('Our Baron')).toBe('shield');
    expect(objectiveIcon('Grubs, theirs (3)')).toBe('bug_report');
    expect(objectiveIcon('Our herald')).toBe('visibility');
    expect(objectiveIcon('Something else')).toBe('flag');
  });
});

describe('capTokens', () => {
  const tok = (kind: RiftToken['kind'], sec: number): RiftToken => ({ key: `${kind}:${sec}`, kind, sec, x: 0, y: 0, label: kind, icon: '' });

  it('keeps everything under the cap', () => {
    const list = [tok('back', 1), tok('ourDeath', 2)];
    expect(capTokens(list, MAX_TOKENS)).toBe(list);
    expect(MAX_TOKENS).toBe(60);
  });

  it('drops the oldest backs first, then plates, and never a death of ours before the rest', () => {
    const list = [tok('back', 1), tok('back', 2), tok('plate', 3), tok('ourDeath', 4), tok('theirDeath', 5), tok('objective', 6)];
    expect(capTokens(list, 4).map((t) => t.key)).toEqual(['plate:3', 'ourDeath:4', 'theirDeath:5', 'objective:6']);
    expect(capTokens(list, 2).map((t) => t.key)).toEqual(['ourDeath:4', 'objective:6']);
    expect(capTokens(list, 1).map((t) => t.key)).toEqual(['ourDeath:4']);
  });
});

describe('RiftMapComponent', () => {
  function mount(inputs: Partial<Record<string, unknown>> = {}) {
    const fixture = TestBed.createComponent(RiftMapComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  it('shows only what happened by the clock second and says the positions are approximate', () => {
    const fixture = mount({ events, until: 500 });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.rift-token').length).toBe(4);
    expect(el.querySelector('.rift-map-note')?.textContent).toBe('Approximate, by zone');
    fixture.componentRef.setInput('until', null);
    fixture.detectChanges();
    expect(el.querySelectorAll('.rift-token').length).toBe(6);
    expect(el.querySelector('.rift-token.is-objective.is-them .material-symbols-rounded')?.textContent).toBe('pets');
    expect(el.querySelector('.rift-token.is-objective.is-us .material-symbols-rounded')?.textContent).toBe('shield');
  });

  it('lets a pin outrank the tape event with the same key, selects it with badges, and emits pick on tap', () => {
    const fixture = mount({ events, pins, selected: 'd:3:ADC' });
    const el = fixture.nativeElement as HTMLElement;
    const deaths = el.querySelectorAll('.rift-token.is-ourDeath');
    expect(deaths.length).toBe(2);
    const selected = el.querySelector('.rift-token.is-selected') as HTMLButtonElement;
    expect(selected.getAttribute('aria-label')).toContain('Rhu');
    expect(Array.from(selected.querySelectorAll('.rift-badge .material-symbols-rounded')).map((b) => b.textContent)).toEqual(['visibility_off', 'person_pin_circle']);
    expect(el.querySelectorAll('.rift-ring').length).toBe(2);
    const picked: string[] = [];
    fixture.componentInstance.pick.subscribe((k) => picked.push(k));
    (deaths[1] as HTMLButtonElement).click();
    expect(picked).toEqual(['d:14:Top']);
  });

  it('dims a pin the filter does not match and draws the clusters', () => {
    const fixture = mount({ pins, filter: 'jungle', clusters: [{ x: 30, y: 30, r: 6, ours: 2, theirs: 1, line: 'A fight at Baron' }], theirs: [{ x: 50, y: 50, minute: 9 }] });
    const el = fixture.nativeElement as HTMLElement;
    const faded = el.querySelectorAll('.rift-token.is-faded');
    expect(faded.length).toBe(1);
    expect(faded[0].getAttribute('aria-label')).toContain('Rhu');
    expect(el.querySelectorAll('.rift-cluster').length).toBe(1);
    expect(el.querySelectorAll('.rift-token.is-theirDeath').length).toBe(1);
  });
});
