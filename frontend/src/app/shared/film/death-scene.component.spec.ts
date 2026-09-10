import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FilmDeathScene } from '../../core/film-model';
import { DeathSceneComponent, hostileMarks, MAX_HOSTILES } from './death-scene.component';

const bare: FilmDeathScene = { could: [], killers: 1, executed: false, traded: 0, warded: true };

describe('hostileMarks', () => {
  it('fans at most five marks across the upper right, each turned to face the victim', () => {
    expect(hostileMarks(0)).toEqual([]);
    expect(hostileMarks(1).length).toBe(1);
    expect(hostileMarks(3).length).toBe(3);
    expect(hostileMarks(9).length).toBe(MAX_HOSTILES);
    for (const m of hostileMarks(5)) {
      // Upper right of the victim, clear of the objective caption at the top and the jungler's line below.
      expect(m.x).toBeGreaterThan(135);
      expect(m.y).toBeLessThan(88);
      expect(m.y).toBeGreaterThan(50);
      // The wedge points along +x; turning it by the angle plus a half turn aims it back at the centre.
      expect(m.rotate).toBeGreaterThanOrEqual(115);
      expect(m.rotate).toBeLessThanOrEqual(175);
    }
  });
});

describe('DeathSceneComponent', () => {
  function mount(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(DeathSceneComponent);
    fixture.componentRef.setInput('scene', bare);
    fixture.componentRef.setInput('read', 'clean');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the ground, the victim in a ring the colour of the read, and nothing that does not apply', () => {
    const el = mount({ champion: 'Jinx', name: 'Rhu', label: 'Clean: nothing on the map would have stopped this one.' });
    const svg = el.querySelector('svg.death-scene') as SVGSVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Clean: nothing on the map would have stopped this one.');
    expect(svg.querySelector('.death-scene-ground')).toBeTruthy();
    expect(svg.querySelector('.death-scene-ring')?.classList.contains('is-read-clean')).toBe(true);
    expect(svg.querySelector('.death-scene-img')?.getAttribute('href')).toContain('Jinx');
    expect(svg.textContent).toContain('Rhu');
    expect(svg.querySelector('.death-scene-ward')).toBeNull();
    expect(svg.querySelector('.death-scene-our-jungler')).toBeNull();
    expect(svg.querySelector('.death-scene-their-jungler')).toBeNull();
    expect(svg.querySelector('.death-scene-midline')).toBeNull();
    expect(svg.querySelector('.death-scene-objective')).toBeNull();
    expect(svg.querySelector('.death-scene-trade')).toBeNull();
    expect(svg.querySelector('.death-scene-executed')).toBeNull();
    expect(svg.querySelectorAll('.death-scene-hostile').length).toBe(1);
    expect(svg.classList.contains('is-active')).toBe(false);
  });

  it('falls back to the read word for the label and a skull for an unknown champion', () => {
    const el = mount({ read: 'avoidable' });
    const svg = el.querySelector('svg.death-scene') as SVGSVGElement;
    expect(svg.getAttribute('aria-label')).toBe('Avoidable');
    expect(svg.querySelector('.death-scene-img')).toBeNull();
    expect(svg.querySelector('.death-scene-ring')?.classList.contains('is-read-avoidable')).toBe(true);
    expect(svg.querySelectorAll('.death-scene-part > .death-scene-glyph path').length).toBeGreaterThan(0);
  });

  it('draws the ward blob only for the ward tag, and the jungler line only for the jungle tag, with the zone under it', () => {
    const el = mount({
      read: 'avoidable',
      scene: { ...bare, could: ['ward', 'jungle'], killers: 2, alliesNear: 0, ourJungler: { champion: 'LeeSin', zone: 'theirJungle', far: true } } as FilmDeathScene
    });
    const svg = el.querySelector('svg.death-scene') as SVGSVGElement;
    expect(svg.querySelector('.death-scene-ward')).toBeTruthy();
    expect(svg.querySelector('.death-scene-bush')).toBeTruthy();
    expect(svg.querySelector('.death-scene-our-jungler .death-scene-line')).toBeTruthy();
    expect(svg.querySelector('.death-scene-our-jungler .death-scene-img')?.getAttribute('href')).toContain('LeeSin');
    const captions = Array.from(svg.querySelectorAll('.death-scene-caption')).map((t) => t.textContent);
    expect(captions).toContain('no ward');
    expect(captions).toContain('a screen away');
    expect(captions).toContain('their jungle');
    expect(captions).toContain('alone');
    expect(svg.querySelectorAll('.death-scene-ally').length).toBe(0);
    expect(svg.querySelectorAll('.death-scene-hostile').length).toBe(2);
    expect(svg.querySelector('.death-scene-their-jungler')).toBeNull();
    expect(svg.querySelector('.death-scene-midline')).toBeNull();
  });

  it('says how many were near, and stays quiet about being alone on a death that was not avoidable', () => {
    const el = mount({ read: 'traded', scene: { ...bare, alliesNear: 2, traded: 2 } as FilmDeathScene });
    const svg = el.querySelector('svg.death-scene') as SVGSVGElement;
    expect(svg.querySelectorAll('.death-scene-ally').length).toBe(2);
    expect(svg.textContent).toContain('2 near');
    // Only what the scene holds: two of theirs fell; how many of ours it does not know, so it never claims "for 1".
    expect(svg.querySelector('.death-scene-trade .death-scene-caption')?.textContent).toBe('2 of theirs');
    expect(svg.textContent).not.toContain('for 1');
    const quiet = mount({ read: 'clean', scene: { ...bare, alliesNear: 0 } as FilmDeathScene });
    expect(quiet.textContent).not.toContain('alone');
    expect(quiet.querySelector('.death-scene-allies')).toBeNull();
  });

  it('shows the objective it bought with its glyph, the tower on an execution, and the midline on their side', () => {
    const el = mount({
      read: 'bought',
      scene: { ...bare, could: ['position'], executed: true, objective: { type: 'dragon', ours: true } } as FilmDeathScene
    });
    const svg = el.querySelector('svg.death-scene') as SVGSVGElement;
    expect(svg.querySelector('.death-scene-objective .death-scene-glow')).toBeTruthy();
    expect(svg.querySelector('.death-scene-objective .death-scene-caption')?.textContent).toBe('taken');
    expect(svg.querySelector('.death-scene-obj')?.classList.contains('is-theirs')).toBe(false);
    expect(svg.querySelector('.death-scene-executed .death-scene-tower')).toBeTruthy();
    expect(svg.querySelector('.death-scene-midline')).toBeTruthy();
    expect(svg.textContent).toContain('their side');
    const theirs = mount({ read: 'clean', scene: { ...bare, objective: { type: 'baron', ours: false } } as FilmDeathScene });
    expect(theirs.querySelector('.death-scene-objective .death-scene-caption')?.textContent).toBe('theirs');
    expect(theirs.querySelector('.death-scene-obj')?.classList.contains('is-theirs')).toBe(true);
  });

  it('draws their jungler as a champion with an arrow in, and never a name', () => {
    const el = mount({
      read: 'avoidable',
      scene: { ...bare, could: ['call'], theirJungler: { champion: 'Nocturne', close: true } } as FilmDeathScene,
      name: 'Rhu',
      champion: 'Jinx',
      active: true
    });
    const svg = el.querySelector('svg.death-scene') as SVGSVGElement;
    const theirs = svg.querySelector('.death-scene-their-jungler') as SVGGElement;
    expect(theirs).toBeTruthy();
    expect(theirs.querySelector('.death-scene-img')?.getAttribute('href')).toContain('Nocturne');
    expect(theirs.querySelector('.death-scene-arrow')?.getAttribute('pathLength')).toBe('100');
    expect(theirs.querySelector('.death-scene-arrow-head')).toBeTruthy();
    // The only words in that group are the caption; our own name sits with the victim, never here.
    expect(theirs.textContent?.trim()).toBe('already close');
    expect(theirs.querySelector('title')).toBeNull();
    expect(svg.classList.contains('is-active')).toBe(true);
    expect(el.classList.contains('is-active')).toBe(true);
    // Their jungler with no champion known falls back to the paw, still nameless.
    const paw = mount({ read: 'avoidable', scene: { ...bare, could: ['call'], theirJungler: { close: true } } as FilmDeathScene });
    expect(paw.querySelector('.death-scene-their-jungler .death-scene-img')).toBeNull();
    expect(paw.querySelector('.death-scene-their-jungler .death-scene-glyph.is-them')).toBeTruthy();
  });

  it('gives every part its place in the story for the staggered entrance', () => {
    const el = mount({
      read: 'traded',
      scene: { ...bare, could: ['ward', 'jungle', 'call', 'position'], killers: 3, alliesNear: 1, executed: true, traded: 1, objective: { type: 'herald', ours: false } } as FilmDeathScene
    });
    const order = Array.from(el.querySelectorAll('.death-scene-part')).map((g) => (g as SVGGElement).style.getPropertyValue('--i'));
    expect(order).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  });
});
