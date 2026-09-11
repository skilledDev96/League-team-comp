import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { DEATH_READS, READ_LABELS } from '../../core/death-reads';
import { REACH_SECONDS } from '../../core/position-lab';
import { HEAT_ROWS, LAB_SECTION, MarkLegendComponent, marksFor, MarkSurface, READ_SECTION } from './mark-legend.component';

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The three surfaces the film hangs the panel on, as each of them declares itself. */
const MAP: MarkSurface = { reads: true, theirs: true };
const TAPE: MarkSurface = { reads: true, theirs: true, objectives: true, vision: true };
const LAB: MarkSurface = { vision: true, lab: true };

describe('marksFor', () => {
  it('lists only the marks the surface beside it draws', () => {
    // 11 Sep 2026, second fix pass: every host used to get every mark, so the map chapter's panel named a ward, its
    // sight circle and six pit glyphs that square never draws, and the lab's named pins, dots, blobs and both washes.
    const map = marksFor(MAP);
    expect(map.map((s) => s.key)).toEqual(['reads', 'rift']);
    expect(map.flatMap((s) => s.rows).map((r) => r.key)).toEqual(['read:avoidable', 'read:traded', 'read:bought', 'read:clean', 'pin', 'dot', 'blob']);
    // The same map with the wards the vision heat is built from: the two washes, and still no ward and no pit glyph.
    const withHeat = marksFor({ ...MAP, heat: true });
    expect(withHeat.map((s) => s.key)).toEqual(['reads', 'rift', 'vision']);
    expect(withHeat.flatMap((s) => s.rows).map((r) => r.key)).toContain('heat-ward');
    expect(withHeat.flatMap((s) => s.rows).map((r) => r.key)).not.toContain('ward');

    // The tape draws the objectives and our vision, which live nowhere else, and no heat.
    const tape = marksFor(TAPE);
    expect(tape.flatMap((s) => s.rows).map((r) => r.key)).toEqual([
      'read:avoidable',
      'read:traded',
      'read:bought',
      'read:clean',
      'pin',
      'dot',
      'blob',
      'objective',
      'ward',
      'sight'
    ]);

    // The lab draws our wards and its own marks, and not one pin, dot, blob, pit glyph or wash.
    const lab = marksFor(LAB);
    expect(lab.map((s) => s.key)).toEqual(['vision', 'lab']);
    expect(lab.flatMap((s) => s.rows).map((r) => r.key)).toEqual(['ward', 'sight', 'lab-death', 'ghost', 'reach', 'safe', 'seen', 'dark', 'rings']);
    expect(LAB_SECTION.rows.map((r) => r.key)).toEqual(['lab-death', 'ghost', 'reach', 'safe', 'seen', 'dark', 'rings']);
    // A surface with nothing on it gets no sections rather than an empty panel of titles.
    expect(marksFor({})).toEqual([]);
    // Every row says something, and no key is used twice.
    const rows = [...tape.flatMap((s) => s.rows), ...LAB_SECTION.rows, ...HEAT_ROWS];
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.text.trim().endsWith('.')).toBe(true);
    }
  });

  it('takes the reads\' words and glyphs from the map\'s own labels, so the two can never drift', () => {
    expect(READ_SECTION.rows).toHaveLength(DEATH_READS.length);
    for (const [i, read] of DEATH_READS.entries()) {
      const row = READ_SECTION.rows[i];
      expect(row.name).toBe(READ_LABELS[read].label);
      expect(row.glyph).toBe(READ_LABELS[read].icon);
      expect(row.text).toBe(`${READ_LABELS[read].tip}.`);
      expect(row.mark).toContain(`is-read-${read}`);
    }
  });

  it('reads the lab\'s reach off the lab\'s own constant', () => {
    const reach = LAB_SECTION.rows.find((r) => r.key === 'reach')!;
    expect(reach.text).toContain(`${REACH_SECONDS} seconds on foot`);
  });
});

describe('MarkLegendComponent', () => {
  function mount(inputs: Partial<Record<string, unknown>> = {}) {
    const fixture = TestBed.createComponent(MarkLegendComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('is a pill until it is opened, and then a panel of one row per mark', () => {
    const { fixture, root } = mount({ surface: TAPE });
    const pill = root.querySelector<HTMLButtonElement>('.mark-legend-btn')!;
    expect(pill.tagName).toBe('BUTTON');
    expect(text(pill)).toContain('What the marks mean');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.mark-legend-panel')).toBeNull();

    pill.click();
    fixture.detectChanges();
    const panel = root.querySelector('.mark-legend-panel')!;
    expect(panel.getAttribute('role')).toBe('group');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(pill.classList.contains('active')).toBe(true);
    // A row per mark, in the sections' order, each with its name and its sentence.
    const rows = Array.from(root.querySelectorAll('.mark-legend-row'));
    expect(rows).toHaveLength(marksFor(TAPE).flatMap((s) => s.rows).length);
    expect(Array.from(root.querySelectorAll('.mark-legend-title')).map((t) => text(t))).toEqual([
      'How the film reads a death of ours',
      'On the Rift',
      'Vision'
    ]);
    expect(text(rows[0])).toContain('Avoidable');
    expect(text(rows[0])).toContain(READ_LABELS.avoidable.tip);
    // The marks are drawn, not described: the read wears its own colour class and the film's glyph, never a Material icon.
    expect(rows[0].querySelector('.mark-legend-mark')?.className).toContain('is-read-avoidable');
    expect(rows[0].querySelector('.mark-legend-mark .film-glyph')?.getAttribute('data-glyph')).toBe(READ_LABELS.avoidable.icon);
    expect(root.querySelector('.mark-legend-row .material-symbols-rounded')).toBeNull();
    // The objectives are one row wearing the six pits' glyphs.
    const objective = rows.find((r) => text(r).startsWith('An objective'))!;
    expect(Array.from(objective.querySelectorAll('.film-glyph')).map((g) => g.getAttribute('data-glyph'))).toEqual(['dragon', 'baron', 'herald', 'grubs', 'atakhan', 'tower']);
    // Every position on the film says how well it is known, this panel included.
    expect(text(root.querySelector('.mark-legend-foot'))).toContain('approximate');
    // Every action here is a pill; nothing is a link.
    expect(root.querySelectorAll('a')).toHaveLength(0);
  });

  it('adds the lab\'s own marks when the host asks for them, and leaves out what the lab never draws', () => {
    const { fixture, root } = mount({ surface: LAB });
    root.querySelector<HTMLButtonElement>('.mark-legend-btn')!.click();
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll('.mark-legend-title')).map((t) => text(t))).toEqual(['Vision', 'In the lab']);
    const rows = Array.from(root.querySelectorAll('.mark-legend-row'));
    expect(rows).toHaveLength(marksFor(LAB).flatMap((s) => s.rows).length);
    expect(rows.some((r) => text(r).startsWith('Where the minute put them'))).toBe(true);
    expect(rows.some((r) => text(r).startsWith('Their reach'))).toBe(true);
    expect(rows.some((r) => text(r).startsWith('The ten tokens'))).toBe(true);
    expect(Array.from(root.querySelectorAll('.mark-legend-mark')).some((m) => m.className.includes('is-shade-dark'))).toBe(true);
    // 11 Sep 2026, second fix pass: no fight blob, no dot of theirs and no pit glyph — the lab draws none of the three.
    expect(rows.some((r) => text(r).startsWith('A fight'))).toBe(false);
    expect(rows.some((r) => text(r).startsWith('A death of theirs'))).toBe(false);
    expect(rows.some((r) => text(r).startsWith('An objective'))).toBe(false);
  });

  it('closes on Escape and on its Close pill, and writes the state back to the host', () => {
    const { fixture, root } = mount();
    const opens: boolean[] = [];
    fixture.componentInstance.open.subscribe((v) => opens.push(v));
    root.querySelector<HTMLButtonElement>('.mark-legend-btn')!.click();
    fixture.detectChanges();
    expect(root.querySelector('.mark-legend-panel')).not.toBeNull();

    // Escape from inside the panel closes it, and stops there: the film page counts two Escapes as "go back".
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    let reachedTheWindow = false;
    const onWindow = () => (reachedTheWindow = true);
    window.addEventListener('keydown', onWindow);
    root.querySelector('.mark-legend-panel')!.dispatchEvent(event);
    window.removeEventListener('keydown', onWindow);
    fixture.detectChanges();
    expect(root.querySelector('.mark-legend-panel')).toBeNull();
    expect(reachedTheWindow).toBe(false);

    // With nothing open the press is not ours: it goes on to whatever the page does with it.
    let secondReached = false;
    const onSecond = () => (secondReached = true);
    window.addEventListener('keydown', onSecond);
    root.querySelector('.mark-legend-btn')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', onSecond);
    expect(secondReached).toBe(true);

    // The Close pill does the same, and the host is told each time.
    root.querySelector<HTMLButtonElement>('.mark-legend-btn')!.click();
    fixture.detectChanges();
    const close = Array.from(root.querySelectorAll<HTMLButtonElement>('.mark-legend-panel .view-btn')).find((b) => text(b).includes('Close'))!;
    close.click();
    fixture.detectChanges();
    expect(root.querySelector('.mark-legend-panel')).toBeNull();
    expect(opens).toEqual([true, false, true, false]);
  });

  it('opens on the host\'s word too, so a page that folds its panels can fold this one', () => {
    const { fixture, root } = mount({ open: true });
    expect(root.querySelector('.mark-legend-panel')).not.toBeNull();
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(root.querySelector('.mark-legend-panel')).toBeNull();
  });
});
