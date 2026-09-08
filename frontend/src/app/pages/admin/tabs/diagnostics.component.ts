import { Component, OnInit, inject, signal } from '@angular/core';
import { ClientError } from '../../../core/error-reporting';
import { DraftEvent } from '../../../models/team.models';
import { TeamDataService } from '../../../services/team-data.service';
import { UiService } from '../../../services/ui.service';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { AdminContextService } from '../admin-context.service';

/** Build, key health, the analysis funnel, and what the draft room did. */
@Component({
  selector: 'app-admin-diagnostics',
  imports: [TooltipDirective],
  templateUrl: './diagnostics.component.html'
})
export class AdminDiagnosticsComponent implements OnInit {
  protected readonly ctx = inject(AdminContextService);
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);

  protected readonly draftEvents = signal<DraftEvent[]>([]);
  protected readonly clientErrors = signal<ClientError[]>([]);
  protected readonly logsLoading = signal(false);
  protected readonly logsError = signal('');

  ngOnInit(): void {
    void this.loadLogs();
  }

  protected async loadLogs(): Promise<void> {
    this.logsLoading.set(true);
    this.logsError.set('');
    try {
      const [events, errors] = await Promise.all([this.data.loadDraftEvents(200), this.data.loadClientErrors(50)]);
      this.draftEvents.set(events);
      this.clientErrors.set(errors);
    } catch (error) {
      this.logsError.set(error instanceof Error ? error.message : 'Could not read the logs.');
    } finally {
      this.logsLoading.set(false);
    }
  }

  /** "vs MAD Synergy · game 1", or the raw id when the series is gone. */
  protected gameLabel(e: DraftEvent): string {
    const series = this.data.tournamentSeries().find((s) => s.id === e.seriesId);
    return `${series ? 'vs ' + series.opponent : e.seriesId} · game ${e.gameNumber}`;
  }

  protected when(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  protected board(e: DraftEvent): string {
    const side = e.board.ourSide ? `${e.board.ourSide} side · ` : '';
    const line = (label: string, list: string[]) => `${label} ${list.filter(Boolean).join(', ') || '—'}`;
    return `${side}${line('bans', e.board.bans)} · ${line('ours', e.board.ourChampions)} · ${line('theirs', e.board.theirChampions)}`;
  }
}
