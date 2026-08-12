import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Comp, CompPicks, FillIn, Player, ROLES, Role } from '../../models/team.models';
import { TeamDataService } from '../../services/team-data.service';

interface PlayerDraft {
  id: string;
  name: string;
  role: Role;
  icon: string;
  playstyle: string;
  strengths: string;
  weaknesses: string;
  top3: string;
  learn: string;
  bans: string;
  region: string;
  opggSlug: string;
  riotTag: string;
  mobalyticsSlug: string;
}

interface FillInDraft {
  id: string;
  summoner: string;
  status: string;
  preferredRoles: string;
  note: string;
  icon: string;
  region: string;
  mobalyticsSlug: string;
}

interface CompDraft {
  id: string;
  name: string;
  picks: CompPicks;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function emptyPicks(): CompPicks {
  return { Top: '', Jungle: '', Mid: '', ADC: '', Support: '' };
}

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink],
  templateUrl: './admin.component.html'
})
export class AdminComponent {
  protected readonly data = inject(TeamDataService);
  protected readonly roles = ROLES;

  protected readonly teamName = signal('');
  protected readonly playerDrafts = signal<PlayerDraft[]>([]);
  protected readonly fillInDrafts = signal<FillInDraft[]>([]);
  protected readonly compDrafts = signal<CompDraft[]>([]);
  protected readonly status = signal('');

  private initialized = false;

  constructor() {
    effect(() => {
      const players = this.data.players();
      const fillIns = this.data.fillIns();
      const comps = this.data.comps();
      if (!this.data.ready() || this.initialized) {
        return;
      }
      this.initialized = true;
      this.teamName.set(this.data.settings().teamName);
      this.playerDrafts.set(players.map((p) => this.toPlayerDraft(p)));
      this.fillInDrafts.set(fillIns.map((f) => this.toFillInDraft(f)));
      this.compDrafts.set(comps.map((c) => ({ id: c.id, name: c.name, picks: { ...c.picks } })));
    });
  }

  private toPlayerDraft(p: Player): PlayerDraft {
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      icon: p.icon ?? '',
      playstyle: p.playstyle ?? '',
      strengths: p.strengths.join(', '),
      weaknesses: p.weaknesses.join(', '),
      top3: p.top3.join(', '),
      learn: p.learn ?? '',
      bans: p.bans.join(', '),
      region: p.profile?.region ?? 'euw',
      opggSlug: p.profile?.opggSlug ?? '',
      riotTag: p.profile?.riotTag ?? '',
      mobalyticsSlug: p.profile?.mobalyticsSlug ?? ''
    };
  }

  private toFillInDraft(f: FillIn): FillInDraft {
    return {
      id: f.id,
      summoner: f.summoner,
      status: f.status,
      preferredRoles: f.preferredRoles.join(', '),
      note: f.note ?? '',
      icon: f.icon ?? '',
      region: f.profile?.region ?? 'euw',
      mobalyticsSlug: f.profile?.mobalyticsSlug ?? ''
    };
  }

  private flash(message: string): void {
    this.status.set(message);
    setTimeout(() => this.status.set(''), 2500);
  }

  // ---- Settings ---------------------------------------------------------

  async saveSettings(): Promise<void> {
    await this.data.updateSettings({ teamName: this.teamName().trim() || 'Bom Squad' });
    this.flash('Team name saved.');
  }

  // ---- Players ----------------------------------------------------------

  addPlayer(): void {
    this.playerDrafts.update((list) => [
      ...list,
      {
        id: '',
        name: '',
        role: 'Top',
        icon: '',
        playstyle: '',
        strengths: '',
        weaknesses: '',
        top3: '',
        learn: '',
        bans: '',
        region: 'euw',
        opggSlug: '',
        riotTag: 'EUW',
        mobalyticsSlug: ''
      }
    ]);
  }

  async savePlayer(draft: PlayerDraft): Promise<void> {
    const profile = {
      region: draft.region.trim() || 'euw',
      opggSlug: draft.opggSlug.trim(),
      riotTag: draft.riotTag.trim(),
      mobalyticsSlug: draft.mobalyticsSlug.trim()
    };
    const base = {
      name: draft.name.trim(),
      role: draft.role,
      icon: draft.icon.trim() || undefined,
      playstyle: draft.playstyle.trim() || undefined,
      strengths: splitList(draft.strengths),
      weaknesses: splitList(draft.weaknesses),
      top3: splitList(draft.top3),
      learn: draft.learn.trim() || undefined,
      bans: splitList(draft.bans),
      profile
    };
    if (!base.name) {
      this.flash('Player name is required.');
      return;
    }
    if (draft.id) {
      const existing = this.data.players().find((p) => p.id === draft.id);
      await this.data.updatePlayer({ ...base, id: draft.id, order: existing?.order ?? 0 });
    } else {
      await this.data.createPlayer(base);
      this.initialized = false;
    }
    this.flash(`Saved ${base.name}.`);
  }

  async deletePlayer(draft: PlayerDraft): Promise<void> {
    if (!draft.id) {
      this.playerDrafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!confirm(`Delete player ${draft.name}?`)) {
      return;
    }
    await this.data.deletePlayer(draft.id);
    this.playerDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash(`Deleted ${draft.name}.`);
  }

  // ---- Fill-ins ---------------------------------------------------------

  addFillIn(): void {
    this.fillInDrafts.update((list) => [
      ...list,
      { id: '', summoner: '', status: 'provisional', preferredRoles: '', note: '', icon: '', region: 'euw', mobalyticsSlug: '' }
    ]);
  }

  async saveFillIn(draft: FillInDraft): Promise<void> {
    const base = {
      summoner: draft.summoner.trim(),
      status: draft.status.trim() || 'provisional',
      preferredRoles: splitList(draft.preferredRoles),
      note: draft.note.trim() || undefined,
      icon: draft.icon.trim() || undefined,
      profile: { region: draft.region.trim() || 'euw', mobalyticsSlug: draft.mobalyticsSlug.trim() }
    };
    if (!base.summoner) {
      this.flash('Summoner name is required.');
      return;
    }
    if (draft.id) {
      const existing = this.data.fillIns().find((f) => f.id === draft.id);
      await this.data.updateFillIn({ ...base, id: draft.id, order: existing?.order ?? 0 });
    } else {
      await this.data.createFillIn(base);
      this.initialized = false;
    }
    this.flash(`Saved ${base.summoner}.`);
  }

  async deleteFillIn(draft: FillInDraft): Promise<void> {
    if (!draft.id) {
      this.fillInDrafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!confirm(`Delete fill-in ${draft.summoner}?`)) {
      return;
    }
    await this.data.deleteFillIn(draft.id);
    this.fillInDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash(`Deleted ${draft.summoner}.`);
  }

  // ---- Comps ------------------------------------------------------------

  addComp(): void {
    this.compDrafts.update((list) => [...list, { id: '', name: '', picks: emptyPicks() }]);
  }

  async saveComp(draft: CompDraft): Promise<void> {
    const name = draft.name.trim();
    if (!name) {
      this.flash('Comp name is required.');
      return;
    }
    if (draft.id) {
      const existing = this.data.comps().find((c) => c.id === draft.id);
      await this.data.updateComp({ id: draft.id, name, picks: draft.picks, order: existing?.order ?? 0 });
    } else {
      await this.data.createComp({ name, picks: draft.picks } as Omit<Comp, 'id' | 'order'>);
      this.initialized = false;
    }
    this.flash(`Saved ${name}.`);
  }

  async deleteComp(draft: CompDraft): Promise<void> {
    if (!draft.id) {
      this.compDrafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!confirm(`Delete comp ${draft.name}?`)) {
      return;
    }
    await this.data.deleteComp(draft.id);
    this.compDrafts.update((list) => list.filter((d) => d.id !== draft.id));
    this.flash(`Deleted ${draft.name}.`);
  }

  // ---- Maintenance ------------------------------------------------------

  async seed(): Promise<void> {
    try {
      await this.data.seedFirestore();
      this.flash('Firestore seeded from starter data.');
    } catch (err) {
      this.flash(err instanceof Error ? err.message : 'Seed failed.');
    }
  }

  resetLocal(): void {
    if (!confirm('Reset local data back to the original starter roster?')) {
      return;
    }
    this.data.resetLocal();
    this.initialized = false;
    this.flash('Local data reset.');
  }
}
