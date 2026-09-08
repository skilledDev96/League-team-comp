import { inject, Injectable } from '@angular/core';
import { deriveExpectation, expectationFor } from '../core/comp-expectation';
import { ChampionTraits, Comp, CompExpectation, ROLES } from '../models/team.models';
import { indexTraits, traitsFor } from '../shared/comp-board.util';
import { ChampionDataService } from './champion-data.service';
import { TeamDataService } from './team-data.service';
import { UiService } from './ui.service';

/**
 * A comp's expectation, for any page that has a comp and wants the four
 * axes: the Comps panel edits it, the Games row and the review read it.
 * One place resolves the champions to traits so the pages agree.
 */
@Injectable({ providedIn: 'root' })
export class CompExpectationService {
  private readonly data = inject(TeamDataService);
  private readonly champData = inject(ChampionDataService);
  private readonly ui = inject(UiService);

  traitsOf(comp: Comp): ChampionTraits[] {
    const index = indexTraits(this.data.championTraits());
    const traits: ChampionTraits[] = [];
    for (const role of ROLES) {
      const champion = this.ui.parseCompLine(comp.picks[role] ?? '').champion;
      if (!champion) continue;
      const found = traitsFor(index, this.champData.resolve(champion)?.id);
      if (found) traits.push(found);
    }
    return traits;
  }

  junglerIdOf(comp: Comp): string | undefined {
    const champion = this.ui.parseCompLine(comp.picks['Jungle'] ?? '').champion;
    return champion ? this.champData.resolve(champion)?.id : undefined;
  }

  /** What an editor wrote, else what the champions say. */
  forComp(comp: Comp): { expect: CompExpectation; source: 'derived' | 'edited' } | null {
    return expectationFor(comp, this.traitsOf(comp), this.junglerIdOf(comp));
  }

  derived(comp: Comp): CompExpectation | null {
    return deriveExpectation(this.traitsOf(comp), { junglerId: this.junglerIdOf(comp), name: comp.name });
  }

  /** The comp with its derived expectation stamped on, unless a person set one. */
  stamped(comp: Comp): Comp {
    if (comp.expectSource === 'edited' && comp.expect) return comp;
    const derived = this.derived(comp);
    return derived ? { ...comp, expect: derived, expectSource: 'derived' } : comp;
  }
}
