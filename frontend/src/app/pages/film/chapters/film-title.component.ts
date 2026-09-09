import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FilmModel } from '../../../core/film-model';
import { UiService } from '../../../services/ui.service';
import { TooltipDirective } from '../../../shared/tooltip.directive';
import { FilmFrameComponent, themeIcon, themeLabel } from '../film-frame.component';

/**
 * The title card (9 Sep 2026): the protagonist's splash under a dark
 * gradient, the strip that says what we said we would watch for last game,
 * then the one call before anything is read: what decided this game? One
 * tap, right or wrong, and the headline lands; a wrong chip shows the right
 * one pulsing once and the headline lands anyway. Without a theme on the
 * first work-on there is no call and the headline lands on entry.
 */
@Component({
  selector: 'app-film-title',
  imports: [DatePipe, RouterLink, TooltipDirective, FilmFrameComponent],
  template: `
    @let t = model().title;
    <div class="film-title-art" aria-hidden="true">
      @if (t.protagonist.champion) {
        <img class="film-splash" [src]="ui.championArtUrl(t.protagonist.champion)" (error)="ui.artFallback($event, t.protagonist.champion)" alt="" />
      }
      <span class="film-title-shade"></span>
      <span class="film-letterbox is-top"></span>
      <span class="film-letterbox is-bottom"></span>
    </div>
    <app-film-frame [kicker]="kicker()" [index]="index()" [count]="count()" (next)="next.emit()" (back)="back.emit()">
      @if (t.lastTime; as last) {
        <a class="film-last" [routerLink]="['/film', last.matchId]" appTip="Open the last game's film">
          <span class="film-last-label">Last game you said you'd watch for</span>
          <span class="film-last-text">{{ last.text }}</span>
          @if (last.recurrence) { <span class="film-last-again">{{ last.recurrence }}</span> }
        </a>
      }
      @if (t.call; as call) {
        <div class="film-call" [class.is-done]="revealed()">
          <p class="film-call-q">{{ call.question }}</p>
          <div class="film-chips" role="group" [attr.aria-label]="call.question">
            @for (opt of call.options; track opt; let i = $index) {
              <button
                type="button"
                class="film-chip"
                [class.is-right]="revealed() && i === call.answer"
                [class.is-wrong]="picked() === i && i !== call.answer"
                [class.is-pulse]="revealed() && picked() !== null && picked() !== call.answer && i === call.answer"
                [class.is-picked]="picked() === i"
                [disabled]="revealed()"
                [attr.aria-pressed]="picked() === i"
                (click)="choose(i)"
              >
                <span class="material-symbols-rounded" aria-hidden="true">{{ icon(opt) }}</span>{{ label(opt) }}
              </button>
            }
          </div>
          @if (!revealed()) {
            <button type="button" class="view-btn film-skip" (click)="skip()">Skip the call</button>
          } @else if (picked() !== null) {
            <p class="film-call-why">{{ picked() === call.answer ? 'Called it.' : 'The review called it ' + label(call.options[call.answer]).toLowerCase() + '.' }}</p>
          }
        </div>
      }
      <div reveal>
        @if (revealed()) {
          <div class="film-title-reveal">
            <span class="film-result" [class.is-win]="t.win" [class.is-loss]="!t.win">{{ t.win ? 'Win' : 'Loss' }}</span>
            <h1 class="film-headline">
              @for (w of words(); track $index) {
                <span class="film-word" [style.--i]="$index">{{ w }}</span>{{ $last ? '' : ' ' }}
              }
            </h1>
            <div class="film-lower-third">
              @if (t.lowerThird.date) { <span>{{ t.lowerThird.date | date: 'd MMM' }}</span> }
              @if (t.lowerThird.opponent) { <span>vs {{ t.lowerThird.opponent }}</span> }
              @if (t.lowerThird.durationMin) { <span>{{ t.lowerThird.durationMin }} min</span> }
              @if (t.lowerThird.kills; as k) { <span>Kills {{ k.ours }}–{{ k.theirs }}</span> }
              <span class="film-verdict" [class.is-good]="t.lowerThird.compVerdict === 'as drafted'" [class.is-bad]="t.lowerThird.compVerdict === 'off plan'" [appTip]="t.lowerThird.compWhy || 'Whether the comp did what its game plan expected'">
                {{ t.lowerThird.compName ? t.lowerThird.compName + ': ' : 'Comp: ' }}{{ t.lowerThird.compVerdict }}
              </span>
              <span class="tag film-tier">{{ t.lowerThird.tier === 'timeline' ? 'From the timeline' : 'Totals only' }}</span>
            </div>
          </div>
        }
      </div>
    </app-film-frame>
  `
})
export class FilmTitleComponent {
  readonly model = input.required<FilmModel>();
  readonly kicker = input<string>('The game');
  readonly index = input<number>(0);
  readonly count = input<number>(1);
  /** The option chosen on an earlier visit, so the reveal is already down. */
  readonly earlier = input<number | undefined>(undefined);
  readonly answered = output<{ key: string; choice: number }>();
  readonly next = output<void>();
  readonly back = output<void>();

  protected readonly ui = inject(UiService);

  private readonly pickedNow = signal<number | null>(null);
  private readonly skipped = signal(false);

  protected readonly picked = computed<number | null>(() => {
    const now = this.pickedNow();
    if (now !== null) return now;
    const before = this.earlier();
    return before === undefined || before < 0 ? null : before;
  });
  protected readonly revealed = computed(() => !this.model().title.call || this.picked() !== null || this.skipped());
  protected readonly words = computed(() => this.model().title.headline.split(/\s+/).filter(Boolean));

  protected choose(i: number): void {
    if (this.revealed()) return;
    this.pickedNow.set(i);
    this.answered.emit({ key: 'title', choice: i });
  }

  protected skip(): void {
    this.skipped.set(true);
  }

  protected icon(theme: string): string {
    return themeIcon(theme);
  }

  protected label(theme: string): string {
    return themeLabel(theme);
  }
}
