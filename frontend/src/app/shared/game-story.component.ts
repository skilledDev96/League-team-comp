import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { compareCurve } from '../core/comp-expectation';
import { recordingStory } from '../core/replay-lines';
import { AnalysisGame, CompExpectation, MatchTimeline } from '../models/team.models';
import { MatchTimelineService } from '../services/match-timeline.service';
import { ReplayRecordingService } from '../services/replay-recording.service';
import { influenceOf, INFLUENCE_NOTHING, INFLUENCE_TIP } from '../core/influence';
import { InfoTipComponent } from './info-tip.component';
import { MvpChipComponent } from './mvp-chip.component';
import { TooltipDirective } from './tooltip.directive';

/**
 * How the game went: the gold curve, the lanes, the fights and the deaths
 * nobody was near, read off the derived timeline document. Opens closed,
 * reads the document the first time it opens, and says plainly when there is
 * none — a replay never has one, and a Riot game may still be waiting its
 * turn in the morning backfill.
 *
 * Since 10 Sep 2026 a game with no timeline but a **recording** — the local
 * recorder's walk through the replay in the League client, the only road to
 * a tournament or scrim game, which Riot's API cannot see — shows the
 * recording's own lines instead (`core/replay-lines.ts`). There is no gold
 * in them: the client hands out team gold to nobody.
 *
 * **Who swung it most** joined the panel on 12 Sep 2026. `core/influence.ts` had existed since
 * 11 Sep with exactly one reader — the last chapter of the film room, several clicks in — so the
 * lead reasonably reported that the most influential player was listed nowhere. This is the
 * honest second home: the panel already holds the very gold curve the swing is measured off, so
 * there is no new read and no new card. One chip, one line, and the caveat about Riot keeping the
 * curve a minute at a time stays in the tip. Only the top seat is drawn; the point is who swung
 * it, not a leaderboard of five. A replay has no timeline, so this never renders for a scrim.
 */
@Component({
  selector: 'app-game-story',
  imports: [TooltipDirective, InfoTipComponent, MvpChipComponent],
  template: `
    <details class="intel-collapse game-story" (toggle)="onToggle($event)">
      <summary>
        <span class="material-symbols-rounded" aria-hidden="true">timeline</span>
        How the game went
        @if (facts(); as f) { <small class="muted">{{ f.tier === 'timeline' ? 'from the timeline' : 'totals only' }}</small> }
        @else if (storyLines().length) { <small class="muted">from the replay recorder</small> }
      </summary>
      @if (!game()) {
        <p class="muted">This game is not in the analysis yet.</p>
      } @else if (loading() && !timeline() && !storyLines().length) {
        <!-- Only when there is genuinely nothing to draw yet (11 Sep 2026).
             The recording is read for every opened drawer, Riot game or not,
             and for a Riot game that read comes back empty — letting it win
             here blanked the gold curve and the lane table the drawer already
             had, on every first open. -->
        <p class="muted">Reading the game…</p>
      } @else if (!timeline() && storyLines().length) {
        <!-- A recorded game (10 Sep 2026): the recorder's own sentences, and the same caveat about what a replay can show. -->
        <ul class="list-clean game-story-lines">
          @for (line of storyLines(); track $index) { <li>{{ line }}</li> }
        </ul>
        <p class="muted game-story-caveat">Recorded off the replay <app-info-tip text="The League client reports the events and every player's items, level and scores while a replay plays, once a second. There is no team gold in it — the client gives gold for the spectated player only — and no positions between the frames the recorder kept." /></p>
      } @else if (game()!.queue === 'Scrim') {
        <p class="muted">End-of-game totals only: a replay carries no minute-by-minute data. The lane reads and objectives above are what it knows. Run the replay recorder beside the League client and this fills in.</p>
      } @else if (!timeline()) {
        <p class="muted">No timeline yet. Twenty are fetched each morning, newest prep game first, or one is fetched the moment the game is reviewed.</p>
      } @else {
        @let t = timeline()!;
        @if (sparkline(); as sp) {
          <svg class="gold-spark" [attr.viewBox]="'0 0 ' + sp.w + ' ' + sp.h" preserveAspectRatio="none" role="img"
               [attr.aria-label]="'Team gold difference by minute, from ' + sp.min + ' to ' + sp.max">
            <line class="gold-spark-zero" x1="0" [attr.y1]="sp.zero" [attr.x2]="sp.w" [attr.y2]="sp.zero" />
            @for (tick of sp.ticks; track tick.x) {
              <line class="gold-spark-tick" [attr.x1]="tick.x" y1="0" [attr.x2]="tick.x" [attr.y2]="sp.h" />
            }
            <polyline class="gold-spark-line" [class.pos]="sp.endsUp" [class.neg]="!sp.endsUp" [attr.points]="sp.points" />
          </svg>
          <div class="gold-spark-legend muted">
            <span>Team gold, ours minus theirs</span>
            @for (tick of sp.ticks; track tick.x) { <span>{{ tick.minute }} min</span> }
          </div>
        }
        <!-- Who swung it most: see the note on the class. -->
        @if (swung(); as s) {
          <p class="game-story-swing">
            <app-mvp-chip kind="swing" [champion]="s.champion ?? ''" [name]="s.name ?? ''" [seat]="s.seat" [terms]="s.terms" [note]="influenceTip" />
            <span class="game-story-swing-line">{{ s.line }}</span>
            <app-info-tip [text]="influenceTip" label="How the swing is measured" />
          </p>
        } @else if (t.deaths?.length || t.theirDeaths?.length) {
          <p class="muted game-story-swing-none">{{ nothingToPrice }}</p>
        }
        @if (curveLines().length) {
          <div class="callout is-advice">
            @for (line of curveLines(); track line) { <p>{{ line }}</p> }
          </div>
        }
        @if (t.facts; as f) {
          <ul class="list-clean game-story-lines">
            @for (line of f.lines; track $index) { <li>{{ line }}</li> }
          </ul>
        }
        @if (t.lanes.length) {
          <div class="split-scroll">
            <table class="split-table game-story-lanes">
              <thead>
                <tr><th>Seat</th><th>Ours</th><th>Theirs</th><th appTip="Gold, ours minus theirs, at ten minutes">Gold @10</th><th appTip="CS at ten">CS @10</th><th appTip="XP at ten">XP @10</th><th appTip="The last minute, up to twenty, the gold lead changed hands">Flipped</th></tr>
              </thead>
              <tbody>
                @for (l of t.lanes; track l.seat) {
                  <tr>
                    <td>{{ l.seat }}@if (l.name) { <small class="muted">{{ l.name }}</small> }</td>
                    <td>{{ l.champion }}</td>
                    <td>{{ l.theirChampion }}</td>
                    <td [class.pos]="(l.at10?.gold ?? 0) > 0" [class.neg]="(l.at10?.gold ?? 0) < 0">{{ l.at10 ? signed(l.at10.gold) : '—' }}</td>
                    <td [class.pos]="(l.at10?.cs ?? 0) > 0" [class.neg]="(l.at10?.cs ?? 0) < 0">{{ l.at10 ? signed(l.at10.cs) : '—' }}</td>
                    <td [class.pos]="(l.at10?.xp ?? 0) > 0" [class.neg]="(l.at10?.xp ?? 0) < 0">{{ l.at10 ? signed(l.at10.xp) : '—' }}</td>
                    <td>{{ l.flippedAt !== undefined ? l.flippedAt + ' min' : '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p class="muted game-story-caveat">Approximate by a minute <app-info-tip text="Frames are a minute apart, so who was near an objective and whether a death was warded are approximate. Wards are read from placement events, which carry no position." /></p>
      }
    </details>
  `
})
export class GameStoryComponent {
  private readonly timelines = inject(MatchTimelineService);
  private readonly recordings = inject(ReplayRecordingService);

  readonly game = input<AnalysisGame | undefined>(undefined);
  readonly expect = input<CompExpectation | null>(null);

  protected readonly opened = signal(false);
  private readonly readingTimeline = signal(false);
  private readonly readingRecording = signal(false);
  protected readonly loading = computed(() => this.readingTimeline() || this.readingRecording());

  protected readonly timeline = computed<MatchTimeline | null>(() => {
    const id = this.game()?.matchId;
    return id ? (this.timelines.known().get(id) ?? null) : null;
  });

  /**
   * The recorder's own account of a game Riot cannot see; empty when there is
   * no recording. `recordingStory` rather than `recordingLines`: the two head
   * sentences the review's prompt needs — where the game came from and that
   * there is no gold in it — are what the caveat under the list already says
   * to a reader, so they are not printed back at them.
   */
  protected readonly storyLines = computed<string[]>(() => recordingStory(this.recordings.recordingFor(this.game()?.matchId)));
  protected readonly facts = computed(() => this.timeline()?.facts ?? null);

  /**
   * The seat whose fights moved the gold most, off this same timeline. Only the top one is drawn:
   * the point is "who swung it", not a leaderboard of five.
   */
  protected readonly swung = computed(() => influenceOf(this.game() ?? null, this.timeline())[0] ?? null);
  protected readonly influenceTip = INFLUENCE_TIP;
  protected readonly nothingToPrice = INFLUENCE_NOTHING;
  protected readonly curveLines = computed(() => {
    const t = this.timeline();
    return t ? compareCurve(this.expect(), t.curve) : [];
  });

  protected readonly sparkline = computed(() => {
    const t = this.timeline();
    if (!t || t.goldDiff.length < 2) return null;
    const w = 300;
    const h = 60;
    const pad = 4;
    const max = Math.max(1000, ...t.goldDiff.map((g) => Math.abs(g)));
    const zero = h / 2;
    const x = (m: number) => (m / (t.goldDiff.length - 1)) * w;
    const y = (g: number) => zero - (g / max) * (zero - pad);
    const points = t.goldDiff.map((g, m) => `${x(m).toFixed(1)},${y(g).toFixed(1)}`).join(' ');
    const ticks = [10, 15, 20, 25, 30].filter((m) => m < t.goldDiff.length).map((m) => ({ minute: m, x: x(m) }));
    return { w, h, zero, points, ticks, min: -max, max, endsUp: t.goldDiff[t.goldDiff.length - 1] >= 0 };
  });

  constructor() {
    effect(() => {
      const id = this.game()?.matchId;
      if (!this.opened() || !id) return;
      // A replay has no Riot timeline by definition, so it is never asked for one.
      if (this.game()?.queue !== 'Scrim' && !this.timelines.known().has(id)) {
        this.readingTimeline.set(true);
        void this.timelines.load(id).finally(() => this.readingTimeline.set(false));
      }
      // The recording is asked for on every opened drawer, Riot game or not: a
      // recorded game that Riot can also see keeps its timeline, and one it
      // cannot is the only thing this drawer will have to show. One read a
      // session, shared with the row's frames strip.
      if (!this.recordings.known().has(id)) {
        this.readingRecording.set(true);
        void this.recordings.load(id).finally(() => this.readingRecording.set(false));
      }
    });
  }

  protected onToggle(event: Event): void {
    this.opened.set((event.target as HTMLDetailsElement).open);
  }

  protected signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }
}
