import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Trophy } from '../../../models/team.models';
import { ChampionDataService } from '../../../services/champion-data.service';
import { TeamDataService } from '../../../services/team-data.service';
import { NgModelNameDirective } from '../../../shared/ng-model-name.directive';

/** A trophy as its form holds it: every field a string, so an empty box is simply empty. */
interface TrophyDraft {
  id: string;
  title: string;
  event: string;
  placement: string;
  date: string;
  tournamentId: string;
  champion: string;
  note: string;
}

const PLACINGS = [
  { value: '1', label: 'First' },
  { value: '2', label: 'Second' },
  { value: '3', label: 'Third' },
  { value: '4', label: 'Fourth' },
  { value: '5', label: 'Top 8' }
];

function toDraft(t: Trophy): TrophyDraft {
  return {
    id: t.id,
    title: t.title,
    event: t.event ?? '',
    placement: t.placement ? String(t.placement) : '',
    date: t.date ?? '',
    tournamentId: t.tournamentId ?? '',
    champion: t.champion ?? '',
    note: t.note ?? ''
  };
}

/**
 * Admin › Trophies (13 Sep 2026): what the games cannot prove on their own — a final placing, a Clash cup,
 * a split won before the app kept any games. They stand first in the trophy cabinet on Home.
 *
 * The forms follow the saved trophies, except one somebody is still typing into, so a save from another
 * tab never writes over a half-finished form here.
 */
@Component({
  selector: 'app-admin-trophies',
  imports: [FormsModule, NgModelNameDirective],
  template: `
    <section aria-label="Trophies">
      <div class="view-controls edit-toolbar">
        <h2 class="title-with-icon"><span class="section-icon material-symbols-rounded">emoji_events</span>Trophies</h2>
        <p class="muted edit-hint">What the games cannot prove on their own: a final placing, a cup, a split won before the app kept games. They stand first in the trophy cabinet on Home.</p>
        <button class="view-btn active btn-cta" type="button" (click)="add()">+ Add trophy</button>
      </div>

      <div class="grid">
        @for (draft of drafts(); track $index) {
          <article class="card">
            <label class="field"><span>Title</span>
              <input type="text" required [ngModel]="draft.title" (ngModelChange)="draft.title = $event; touch(draft)" [name]="'trtitle' + $index" placeholder="e.g. Split 1 champions" /></label>
            <div class="grid two">
              <label class="field"><span>Placing</span>
                <select [ngModel]="draft.placement" (ngModelChange)="draft.placement = $event; touch(draft)" [name]="'trplace' + $index">
                  <option value="" [selected]="draft.placement === ''">Not a placing</option>
                  @for (p of placings; track p.value) {
                    <option [value]="p.value" [selected]="draft.placement === p.value">{{ p.label }}</option>
                  }
                </select></label>
              <label class="field"><span>Date</span>
                <input type="date" [ngModel]="draft.date" (ngModelChange)="draft.date = $event; touch(draft)" [name]="'trdate' + $index" /></label>
            </div>
            <div class="grid two">
              <label class="field"><span>Tournament</span>
                <select [ngModel]="draft.tournamentId" (ngModelChange)="draft.tournamentId = $event; touch(draft)" [name]="'trtourn' + $index">
                  <option value="" [selected]="draft.tournamentId === ''">Somewhere else</option>
                  @for (t of tournaments(); track t.id) {
                    <option [value]="t.id" [selected]="draft.tournamentId === t.id">{{ t.name }}</option>
                  }
                </select></label>
              <label class="field"><span>Event</span>
                <input type="text" [ngModel]="draft.event" (ngModelChange)="draft.event = $event; touch(draft)" [name]="'trevent' + $index" placeholder="e.g. Clash — 7 Sep" /></label>
            </div>
            <label class="field"><span>Champion behind it</span>
              <input type="text" list="admin-trophy-champions" [ngModel]="draft.champion" (ngModelChange)="draft.champion = $event; touch(draft)" [name]="'trchamp' + $index" placeholder="e.g. Miss Fortune" /></label>
            <label class="field"><span>Note</span>
              <textarea rows="2" [ngModel]="draft.note" (ngModelChange)="draft.note = $event; touch(draft)" [name]="'trnote' + $index"></textarea></label>
            <div class="links">
              <button class="view-btn active" type="button" [disabled]="saving()" (click)="save(draft)">Save</button>
              <button class="view-btn" type="button" (click)="remove(draft)">Delete</button>
            </div>
          </article>
        } @empty {
          <p class="muted">No trophies yet. Add one above.</p>
        }
      </div>
      <datalist id="admin-trophy-champions">
        @for (name of championNames(); track name) {
          <option [value]="name"></option>
        }
      </datalist>
      @if (status()) {
        <p class="tag good admin-status" role="status">{{ status() }}</p>
      }
    </section>
  `
})
export class AdminTrophiesComponent {
  private readonly data = inject(TeamDataService);
  private readonly champions = inject(ChampionDataService);

  protected readonly placings = PLACINGS;
  protected readonly drafts = signal<TrophyDraft[]>([]);
  protected readonly saving = signal(false);
  protected readonly status = signal('');
  protected readonly tournaments = computed(() => this.data.tournaments().filter((t) => t.kind !== 'scrims'));
  protected readonly championNames = computed(() => this.champions.champions().map((c) => c.name).sort((a, b) => a.localeCompare(b)));

  /** Forms somebody has typed into since they were last saved. */
  private readonly dirty = new Set<TrophyDraft>();

  constructor() {
    effect(() => {
      const saved = this.data.trophies();
      untracked(() =>
        this.drafts.update((list) => [
          ...saved.map((t) => list.find((d) => d.id === t.id && this.dirty.has(d)) ?? toDraft(t)),
          ...list.filter((d) => !d.id)
        ])
      );
    });
  }

  protected touch(draft: TrophyDraft): void {
    this.dirty.add(draft);
  }

  protected add(): void {
    const draft: TrophyDraft = { id: '', title: '', event: '', placement: '', date: '', tournamentId: '', champion: '', note: '' };
    this.dirty.add(draft);
    this.drafts.update((list) => [...list, draft]);
  }

  protected async save(draft: TrophyDraft): Promise<void> {
    const title = draft.title.trim();
    if (!title) {
      this.flash('A trophy needs a title.');
      return;
    }
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const placement = Number(draft.placement);
      const fields: Omit<Trophy, 'id' | 'order'> = {
        title,
        ...(draft.event.trim() ? { event: draft.event.trim() } : {}),
        ...(Number.isInteger(placement) && placement > 0 ? { placement } : {}),
        ...(draft.date.trim() ? { date: draft.date.trim() } : {}),
        ...(draft.tournamentId ? { tournamentId: draft.tournamentId } : {}),
        ...(draft.champion.trim() ? { champion: draft.champion.trim() } : {}),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {})
      };
      if (draft.id) {
        const existing = this.data.trophies().find((t) => t.id === draft.id);
        await this.data.updateTrophy({ ...fields, id: draft.id, order: existing?.order ?? 0 });
      } else {
        // The new form goes before the write lands, or the list following the save would add a second copy of it.
        this.drafts.update((list) => list.filter((d) => d !== draft));
        await this.data.createTrophy(fields);
      }
      this.dirty.delete(draft);
      this.flash(`Saved ${title}.`);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(draft: TrophyDraft): Promise<void> {
    if (!draft.id) {
      this.dirty.delete(draft);
      this.drafts.update((list) => list.filter((d) => d !== draft));
      return;
    }
    if (!confirm(`Delete ${draft.title || 'this trophy'}?`)) return;
    this.dirty.delete(draft);
    await this.data.deleteTrophy(draft.id);
  }

  private flash(message: string): void {
    this.status.set(message);
    setTimeout(() => this.status.set(''), 2500);
  }
}
