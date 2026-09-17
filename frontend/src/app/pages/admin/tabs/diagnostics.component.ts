import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ClientError } from '../../../core/error-reporting';
import { auditSeries } from '../../../core/series-audit';
import { TournamentContextService } from '../../tournaments/tournament-context.service';
import { localDayOf, recordCommand, recordingQueue } from '../../../core/recording-queue';
import { DraftEvent } from '../../../models/team.models';
import { ReplayRecordingService } from '../../../services/replay-recording.service';
import { TeamDataService } from '../../../services/team-data.service';
import { ToastService } from '../../../services/toast.service';
import { TourService } from '../../../services/tour.service';
import { UserPrefsService } from '../../../services/user-prefs.service';
import { UiService } from '../../../services/ui.service';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { banWord } from '../../tournaments/draft-sequence';
import { AdminContextService } from '../admin-context.service';

/** Build, key health, the analysis funnel, and what the draft room did. */
@Component({
  selector: 'app-admin-diagnostics',
  imports: [TooltipDirective, DatePipe, DecimalPipe, NgTemplateOutlet],
  templateUrl: './diagnostics.component.html'
})
export class AdminDiagnosticsComponent implements OnInit {
  protected readonly tours = inject(TourService);
  protected readonly prefs = inject(UserPrefsService);
  protected readonly toursSeen = computed(() => this.tours.available().filter((t) => this.tours.seen(t)).length);

  /** The draft room's test aids, per browser. */
  protected readonly devAids = signal(localStorage.getItem('bom-dev-aids') === '1');
  protected setDevAids(on: boolean): void {
    this.devAids.set(on);
    try {
      if (on) localStorage.setItem('bom-dev-aids', '1');
      else localStorage.removeItem('bom-dev-aids');
    } catch {
      /* private mode */
    }
  }

  protected readonly ctx = inject(AdminContextService);
  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);

  protected readonly draftEvents = signal<DraftEvent[]>([]);
  protected readonly clientErrors = signal<ClientError[]>([]);
  protected readonly logsLoading = signal(false);
  protected readonly logsError = signal('');

  ngOnInit(): void {
    void this.loadLogs();
    void this.loadRecorded();
  }

  // ---- Customs to record (17 Sep 2026) ----------------------------------
  //
  // A replay plays only on the patch it was saved on, so the recorder has until the next patch to
  // read a custom. The card says which are left, when they stop playing, and copies the command.

  private readonly recordings = inject(ReplayRecordingService);
  private readonly toast = inject(ToastService);

  /** The ids of the recordings, read once when the card renders; null until the read comes back. */
  protected readonly recordedIds = signal<string[] | null>(null);
  protected readonly recordedError = signal('');

  protected readonly queue = computed(() =>
    recordingQueue({
      scrims: this.data.scrims(),
      seriesGames: this.data.seriesGames(),
      series: this.data.tournamentSeries(),
      tournaments: this.data.tournaments(),
      recordedIds: this.recordedIds() ?? [],
      nextPatchOn: this.data.settings().nextPatchOn,
      today: localDayOf(Date.now())
    })
  );

  /**
   * Where the closing date came from. An estimate is only as early as the first custom on the patch, and a date in
   * Settings that cannot be this patch's close is passed over, so the tip names it rather than let it look ignored.
   */
  protected readonly closeTip = computed(() => {
    const q = this.queue();
    if (!q.estimated) return 'The date set in Next patch on, in Settings';
    // A passed-over date is either before this patch's first game or three weeks past it, so it falls before or after the estimate.
    const set = this.data.settings().nextPatchOn;
    const whose = set && set < q.closesOn ? 'the last patch' : 'a later patch';
    const passedOver = set ? ` The date set in Settings, ${set}, cannot be when ${q.currentPatch} closes, so it is taken for ${whose}'s.` : '';
    return `The day before two weeks after the first custom saved on ${q.currentPatch}; later if that game came days after the patch landed. Set Next patch on in Settings for the real date.${passedOver}`;
  });

  private async loadRecorded(): Promise<void> {
    this.recordedError.set('');
    try {
      this.recordedIds.set(await this.recordings.recordedIds());
    } catch (error) {
      this.recordedError.set(error instanceof Error ? error.message : 'Could not read the recordings.');
    }
  }

  protected async copyRecordCommand(matchId: string): Promise<void> {
    const command = recordCommand(matchId);
    try {
      await navigator.clipboard.writeText(command);
      this.toast.show('Command copied', { kind: 'ok', icon: 'content_copy', text: `${command}. Run it from the repo while the client plays that replay.` });
    } catch {
      this.toast.show('Could not copy', { kind: 'warn', text: `The browser refused the clipboard; type ${command} instead.` });
    }
  }

  /**
   * Saves `exportTeamData` as bom-squad-YYYY-MM-DD.json (17 Sep 2026). A temporary link is the one
   * way a page hands the browser a file it made; the URL is let go on the next turn, since a browser
   * can drop a download whose URL is revoked in the same tick as the click.
   */
  protected downloadTeamData(): void {
    const blob = new Blob([JSON.stringify(this.data.exportTeamData(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bom-squad-${localDayOf(Date.now())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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

  // ---- Series audit (17 Sep 2026) ----------------------------------------------
  //
  // The list the Plan's series heads wear as chips, one row a finding, each with the
  // way to the series it is about.

  private readonly router = inject(Router);
  private readonly tournamentCtx = inject(TournamentContextService);

  protected readonly seriesAudit = computed(() =>
    auditSeries({
      tournaments: this.data.tournaments(),
      series: this.data.tournamentSeries(),
      seriesGames: this.data.seriesGames(),
      scrims: this.data.scrims(),
      championName: (c) => this.ui.championName(c)
    })
  );

  /** Prep & Draft on that series, the way Home's Scout them goes there. */
  protected openSeries(seriesId: string): void {
    this.tournamentCtx.openPrep(seriesId);
    void this.router.navigate(['/tournaments'], { queryParams: { view: 'plan' } });
  }

  protected when(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /** The board as one line. A ban nobody saw is stored as `NO_BAN` and printed as "not seen" (17 Sep 2026). */
  protected board(e: DraftEvent): string {
    const side = e.board.ourSide ? `${e.board.ourSide} side · ` : '';
    const line = (label: string, list: string[]) => `${label} ${list.filter(Boolean).join(', ') || '—'}`;
    return `${side}${line('bans', e.board.bans.map(banWord))} · ${line('ours', e.board.ourChampions)} · ${line('theirs', e.board.theirChampions)}`;
  }
}
