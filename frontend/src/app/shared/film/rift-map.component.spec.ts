import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FilmDeathPin, FilmDeathScene, FilmTapeEvent } from '../../core/film-model';
import { capTokens, LIT_WINDOW_SEC, MAX_TOKENS, objectiveGlyph, plateLane, RiftMapComponent, RiftToken, staysForSeat } from './rift-map.component';

const events: FilmTapeEvent[] = [
  { sec: 95, kind: 'back', label: 'Top backed', side: 'us', seat: 'Top', x: 8, y: 92 },
  { sec: 200, kind: 'first', label: 'First blood, theirs', side: 'them', x: 40, y: 60 },
  { sec: 210, kind: 'ourDeath', label: 'Rhu (ADC) died', side: 'us', seat: 'ADC', champion: 'Jinx', x: 85, y: 84, key: 'd:3:ADC' },
  { sec: 480, kind: 'objective', label: 'Their dragon (infernal)', side: 'them', x: 69, y: 69 },
  { sec: 900, kind: 'plate', label: 'A plate, ours, bot', side: 'us', x: 80, y: 88 },
  { sec: 1500, kind: 'objective', label: 'Our baron', side: 'us', x: 31, y: 30 }
];

const scene: FilmDeathScene = { could: [], killers: 1, executed: false, traded: 0, warded: false };

const pins: FilmDeathPin[] = [
  {
    key: 'd:3:ADC', sec: 210, minute: 3, seat: 'ADC', name: 'Rhu', champion: 'Jinx', zone: 'bot', x: 85, y: 84, how: 'solo', could: ['ward', 'position'],
    line: 'Rhu (ADC) died at 3 min, alone, in the dark',
    read: 'avoidable', readLine: 'Avoidable: no ward had gone down nearby.', glyphs: ['ward-off', 'footsteps'], scene: { ...scene, could: ['ward', 'position'] }
  },
  {
    key: 'd:14:Top', sec: 840, minute: 14, seat: 'Top', champion: 'Ornn', zone: 'river', x: 30, y: 30, how: 'fight', could: ['jungle'],
    line: 'Ornn died at 14 min in a fight at Baron',
    read: 'bought', readLine: 'Bought the baron at minute 14.', glyphs: ['coin', 'baron'], scene: { ...scene, could: ['jungle'], objective: { type: 'baron', ours: true } }
  }
];

/** A pin from before the reads existed: no glyphs, so the badges fall back to its tags'. */
const bareTagPin: FilmDeathPin = {
  key: 'd:20:Mid', sec: 1200, minute: 20, seat: 'Mid', champion: 'Ahri', zone: 'mid', x: 50, y: 50, how: 'gank', could: ['call'],
  line: 'Ahri died at 20 min to a gank', read: 'avoidable', readLine: 'Avoidable: a call would have pulled her out.', glyphs: [], scene: { ...scene, could: ['call'] }
};

describe('objectiveGlyph', () => {
  it('reads the kind off the tape label as one of the film\'s own glyphs', () => {
    expect(objectiveGlyph('Their dragon (infernal)')).toBe('dragon');
    expect(objectiveGlyph('Our elder dragon')).toBe('dragon');
    expect(objectiveGlyph('Our Baron')).toBe('baron');
    expect(objectiveGlyph('Grubs, theirs (3)')).toBe('grubs');
    expect(objectiveGlyph('Our herald')).toBe('herald');
    expect(objectiveGlyph('Their Atakhan')).toBe('atakhan');
    expect(objectiveGlyph('Something else')).toBe('flag');
  });
});

describe('plateLane and staysForSeat', () => {
  const tok = (kind: RiftToken['kind'], label: string, extra: Partial<RiftToken> = {}): RiftToken => ({ key: `${kind}:${label}`, kind, sec: 0, x: 0, y: 0, label, ...extra });

  it('reads the lane off a plate\'s label, and nothing off a label without one', () => {
    expect(plateLane('Plate down, top, by 14 min')).toBe('top');
    expect(plateLane('2 plates down, bot, by 14 min')).toBe('bot');
    expect(plateLane('3 plates down, mid, by 14 min')).toBe('mid');
    expect(plateLane('A plate')).toBeNull();
  });

  it('keeps the seat\'s deaths and backs, its lane\'s plates, every objective and first, their deaths, and always the selected pin', () => {
    expect(staysForSeat(tok('ourDeath', 'Rhu died', { seat: 'ADC', pinKey: 'd:3:ADC' }), 'ADC', null)).toBe(true);
    expect(staysForSeat(tok('ourDeath', 'Rhu died', { seat: 'ADC', pinKey: 'd:3:ADC' }), 'Top', null)).toBe(false);
    expect(staysForSeat(tok('ourDeath', 'Rhu died', { seat: 'ADC', pinKey: 'd:3:ADC' }), 'Top', 'd:3:ADC')).toBe(true);
    expect(staysForSeat(tok('back', 'Top backed', { seat: 'Top' }), 'Top', null)).toBe(true);
    expect(staysForSeat(tok('back', 'Top backed', { seat: 'Top' }), 'Jungle', null)).toBe(false);
    // Bot lane's plates belong to the ADC's and the Support's view alike; the jungler has no lane.
    expect(staysForSeat(tok('plate', '2 plates down, bot, by 14 min'), 'ADC', null)).toBe(true);
    expect(staysForSeat(tok('plate', '2 plates down, bot, by 14 min'), 'Support', null)).toBe(true);
    expect(staysForSeat(tok('plate', '2 plates down, bot, by 14 min'), 'Mid', null)).toBe(false);
    expect(staysForSeat(tok('plate', 'Plate down, top, by 14 min'), 'Jungle', null)).toBe(false);
    for (const seat of ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] as const) {
      expect(staysForSeat(tok('objective', 'Their dragon (infernal)', { side: 'them' }), seat, null)).toBe(true);
      expect(staysForSeat(tok('first', 'First blood, theirs', { side: 'them' }), seat, null)).toBe(true);
      expect(staysForSeat(tok('theirDeath', 'One of theirs died', { side: 'them' }), seat, null)).toBe(true);
    }
  });
});

describe('capTokens', () => {
  const tok = (kind: RiftToken['kind'], sec: number): RiftToken => ({ key: `${kind}:${sec}`, kind, sec, x: 0, y: 0, label: kind });

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
    // The pits wear the film's own glyphs, the same dragon the tape's card draws, and no Material icon anywhere on the map.
    expect(el.querySelector('.rift-token.is-objective.is-them .rift-obj svg.film-glyph')?.getAttribute('data-glyph')).toBe('dragon');
    expect(el.querySelector('.rift-token.is-objective.is-us .rift-obj svg.film-glyph')?.getAttribute('data-glyph')).toBe('baron');
    expect(el.querySelector('.rift-obj .material-symbols-rounded')).toBeNull();
  });

  it('lights a seat\'s tokens only near the moment\'s second, every one of them with no second', () => {
    const late: FilmTapeEvent[] = [...events, { sec: 1520, kind: 'ourDeath', label: 'Rhu (ADC) died', side: 'us', seat: 'ADC', champion: 'Jinx', x: 30, y: 32, key: 'd:25:ADC' }];
    const fixture = mount({ events: late, highlightSeats: ['ADC'], highlightSec: 25 * 60 });
    const el = fixture.nativeElement as HTMLElement;
    const lit = () => el.querySelectorAll('.rift-token.is-lit').length;
    expect(lit()).toBe(1);
    expect(el.querySelector('.rift-token.is-lit')?.className).toContain('is-ourDeath');
    fixture.componentRef.setInput('highlightSec', null);
    fixture.detectChanges();
    expect(lit()).toBe(2);
    // The Top back at 95 s is not the ADC's; the ADC's death at 210 s is within the window, the one at 1520 s is not.
    fixture.componentRef.setInput('highlightSec', 95);
    fixture.detectChanges();
    expect(lit()).toBe(1);
    expect(LIT_WINDOW_SEC).toBe(120);
  });

  it('lets a pin outrank the tape event with the same key, selects it with badges, and emits pick on tap', () => {
    const fixture = mount({ events, pins, selected: 'd:3:ADC' });
    const el = fixture.nativeElement as HTMLElement;
    const deaths = el.querySelectorAll('.rift-token.is-ourDeath');
    expect(deaths.length).toBe(2);
    const selected = el.querySelector('.rift-token.is-selected') as HTMLButtonElement;
    expect(selected.getAttribute('aria-label')).toContain('Rhu');
    // The badges are the film's own glyphs, the pin's list in its order, and no Material icon.
    expect(Array.from(selected.querySelectorAll('.rift-badge svg.film-glyph')).map((b) => b.getAttribute('data-glyph'))).toEqual(['ward-off', 'footsteps']);
    expect(selected.querySelector('.rift-badge .material-symbols-rounded')).toBeNull();
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

  it('marks each pin with its read, and the read filter fades the pins of the other reads', () => {
    const fixture = mount({ pins, readFilter: 'bought' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.rift-token.is-read-bought')?.getAttribute('aria-label')).toContain('Ornn');
    expect(el.querySelector('.rift-token.is-read-avoidable')?.getAttribute('aria-label')).toContain('Rhu');
    let faded = el.querySelectorAll('.rift-token.is-faded');
    expect(faded.length).toBe(1);
    expect(faded[0].classList.contains('is-read-avoidable')).toBe(true);
    // Both filters stack: a bought death with the jungle tag passes both, an avoidable one with it fails the read.
    fixture.componentRef.setInput('filter', 'jungle');
    fixture.detectChanges();
    expect(el.querySelectorAll('.rift-token.is-faded').length).toBe(1);
    fixture.componentRef.setInput('readFilter', 'all');
    fixture.componentRef.setInput('filter', 'all');
    fixture.detectChanges();
    expect(el.querySelectorAll('.rift-token.is-faded').length).toBe(0);
    // An unread pin never fades, whatever the read filter says.
    fixture.componentRef.setInput('readFilter', 'bought');
    fixture.componentRef.setInput('unreadKeys', ['d:3:ADC']);
    fixture.detectChanges();
    faded = el.querySelectorAll('.rift-token.is-faded');
    expect(faded.length).toBe(0);
    // A tape event for a death of ours carries no read, so it gets no read class.
    fixture.componentRef.setInput('pins', []);
    fixture.componentRef.setInput('events', events);
    fixture.detectChanges();
    expect(el.querySelector('.rift-token.is-ourDeath')?.className).not.toContain('is-read-');
  });

  it('shows one seat at a time: its deaths and backs, its lane\'s plates, every objective, their dots faded, and never hides the selected pin', () => {
    const fixture = mount({ events, pins, theirs: [{ x: 50, y: 50, minute: 9 }], seatFilter: 'ADC' });
    const el = fixture.nativeElement as HTMLElement;
    const count = (sel: string) => el.querySelectorAll(sel).length;
    // ADC: Rhu's pin stays and Ornn's (Top) goes; the Top back goes; the bot plate stays; both pits and the first stay; their dot steps back.
    expect(count('.rift-token.is-ourDeath')).toBe(1);
    expect(el.querySelector('.rift-token.is-ourDeath')?.getAttribute('aria-label')).toContain('Rhu');
    expect(count('.rift-token.is-back')).toBe(0);
    expect(count('.rift-token.is-plate')).toBe(1);
    expect(count('.rift-token.is-objective')).toBe(2);
    expect(count('.rift-token.is-first')).toBe(1);
    expect(el.querySelector('.rift-token.is-theirDeath')?.classList.contains('is-faded')).toBe(true);
    expect(count('.rift-token.is-faded')).toBe(1);
    expect(el.classList.contains('has-seat-filter')).toBe(true);
    // Top: Ornn's pin and the Top back stay, the bot plate goes.
    fixture.componentRef.setInput('seatFilter', 'Top');
    fixture.detectChanges();
    expect(count('.rift-token.is-ourDeath')).toBe(1);
    expect(el.querySelector('.rift-token.is-ourDeath')?.getAttribute('aria-label')).toContain('Ornn');
    expect(count('.rift-token.is-back')).toBe(1);
    expect(count('.rift-token.is-plate')).toBe(0);
    expect(count('.rift-token.is-objective')).toBe(2);
    // Jungle: no death of the jungler's here and no lane, so no plates; the pits still stand.
    fixture.componentRef.setInput('seatFilter', 'Jungle');
    fixture.detectChanges();
    expect(count('.rift-token.is-ourDeath')).toBe(0);
    expect(count('.rift-token.is-plate')).toBe(0);
    expect(count('.rift-token.is-objective')).toBe(2);
    // The selected pin is never hidden, whichever seat is in view, and keeps its ring.
    fixture.componentRef.setInput('seatFilter', 'Top');
    fixture.componentRef.setInput('selected', 'd:3:ADC');
    fixture.detectChanges();
    expect(count('.rift-token.is-ourDeath')).toBe(2);
    expect(el.querySelector('.rift-token.is-selected')?.getAttribute('aria-label')).toContain('Rhu');
    expect(count('.rift-ring')).toBe(2);
    // All puts everything back, their dot at full weight.
    fixture.componentRef.setInput('seatFilter', 'all');
    fixture.detectChanges();
    expect(count('.rift-token')).toBe(8);
    expect(count('.rift-token.is-faded')).toBe(0);
    expect(el.classList.contains('has-seat-filter')).toBe(false);
  });

  it('shrinks the list before the cap, so a seat\'s own tokens never lose their place to hidden ones', () => {
    // Sixty Top backs and then the ADC's death: under the cap the death is what stays; under the ADC's view the backs are gone before the cap counts.
    const crowded: FilmTapeEvent[] = [
      ...Array.from({ length: MAX_TOKENS }, (_, i) => ({ sec: i + 1, kind: 'back' as const, label: 'Top backed', side: 'us' as const, seat: 'Top' as const, x: 8, y: 92 })),
      { sec: 2000, kind: 'ourDeath', label: 'Rhu (ADC) died', side: 'us', seat: 'ADC', champion: 'Jinx', x: 85, y: 84, key: 'd:33:ADC' }
    ];
    const fixture = mount({ events: crowded, seatFilter: 'ADC' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.rift-token').length).toBe(1);
    expect(el.querySelector('.rift-token')?.classList.contains('is-ourDeath')).toBe(true);
    fixture.componentRef.setInput('seatFilter', 'Top');
    fixture.detectChanges();
    expect(el.querySelectorAll('.rift-token').length).toBe(MAX_TOKENS);
    expect(el.querySelectorAll('.rift-token.is-ourDeath').length).toBe(0);
  });

  it('falls back to the tags\' glyphs as badges when a pin carries none', () => {
    const fixture = mount({ pins: [bareTagPin], selected: 'd:20:Mid' });
    const el = fixture.nativeElement as HTMLElement;
    const badges = Array.from(el.querySelectorAll('.rift-token.is-selected .rift-badge svg.film-glyph')).map((b) => b.getAttribute('data-glyph'));
    expect(badges).toEqual(['horn']);
  });
});
