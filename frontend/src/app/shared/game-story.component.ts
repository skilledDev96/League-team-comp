import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { compareCurve } from '../core/comp-expectation';
import { AnalysisGame, CompExpectation, MatchTimeline } from '../models/team.models';
import { MatchTimelineService } from '../services/match-timeline.service';
import { TooltipDirective } from './tooltip.directive';

/**
 * How the game went: the gold curve, the lanes, the fights and the deaths
 * nobody was near, read off the derived timeline document. Opens closed,
 * reads the document the first time it opens, and says plainly when there is
 * none — a replay never has one, and a Riot game may still be waiting its
 * turn in the morning backfill.
 */
@Component({
  selector: 'app-game-story',
  imports: [TooltipDirective],
  template: `
    <details class="intel-collapse game-story" (toggle)="onToggle($event)">
      <summary>
        <span class="material-symbols-rounded" aria-hidden="true">timeline</span>
        How the game went
        @if (facts(); as f) { <small class="muted">{{ f.tier === 'timeline' ? 'from the timeline' : 'totals only' }}</small> }
      </summary>
      @if (!game()) {
        <p class="muted">This game is not in the analysis yet.</p>
      } @else if (game()!.queue === 'Scrim') {
        <p class="muted">End-of-game totals only: a replay carries no minute-by-minute data. The lane reads and objectives above are what it knows.</p>
      } @else if (loading()) {
        <p class="muted">Reading the timeline…</p>
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
        <p class="muted game-story-caveat">Frames are a minute apart, so who was near an objective and whether a death was warded are approximate. Wards are read from placement events, which carry no position.</p>
      }
    </details>
  `
})
export class GameStoryComponent {
  private readonly timelines = inject(MatchTimelineService);

  readonly game = input<AnalysisGame | undefined>(undefined);
  readonly expect = input<CompExpectation | null>(null);

  protected readonly opened = signal(false);
  protected readonly loading = signal(false);

  protected readonly timeline = computed<MatchTimeline | null>(() => {
    const id = this.game()?.matchId;
    return id ? (this.timelines.known().get(id) ?? null) : null;
  });
  protected readonly facts = computed(() => this.timeline()?.facts ?? null);
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
      if (!this.opened() || !id || this.game()?.queue === 'Scrim') return;
      if (this.timelines.known().has(id)) return;
      this.loading.set(true);
      void this.timelines.load(id).finally(() => this.loading.set(false));
    });
  }

  protected onToggle(event: Event): void {
    this.opened.set((event.target as HTMLDetailsElement).open);
  }

  protected signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }
}
