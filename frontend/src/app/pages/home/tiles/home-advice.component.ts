import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { HomeAdvice } from '../../../core/home-model';
import { InViewDirective } from '../../../shared/in-view.directive';

/**
 * What we do well and what to work on (13 Sep 2026): the top Keep doing and Work on lines the Patterns
 * tab prints for its default selection, word for word, so the two pages never give the team two answers.
 * A line needs enough wins and enough losses to compare, and until then the tile says how far off it is.
 */
@Component({
  selector: 'app-home-advice',
  imports: [InViewDirective],
  template: `
    @let a = advice();
    <section class="card home-tile home-advice" appInView aria-labelledby="home-advice-title">
      <header class="home-card-head">
        <h2 id="home-advice-title"><span class="material-symbols-rounded" aria-hidden="true">psychology</span> What we do well, and what to work on</h2>
        <button type="button" class="view-btn home-pill" (click)="openPatterns()">
          <span class="material-symbols-rounded" aria-hidden="true">insights</span> Open Patterns
        </button>
      </header>
      @if (ready()) {
        <div class="home-advice-cols">
          <div class="home-advice-col is-good">
            <h3><span class="material-symbols-rounded" aria-hidden="true">thumb_up</span> Keep doing</h3>
            @for (l of a.keepDoing; track l.key) {
              <p class="home-advice-line"><strong>{{ l.strong }}</strong> {{ l.rest }} <small>{{ l.n }}</small></p>
            } @empty {
              <p class="home-tile-note">Nothing stands out in the wins yet.</p>
            }
          </div>
          <div class="home-advice-col is-work">
            <h3><span class="material-symbols-rounded" aria-hidden="true">fitness_center</span> Work on</h3>
            @for (l of a.workOn; track l.key) {
              <p class="home-advice-line"><strong>{{ l.strong }}</strong> {{ l.rest }} <small>{{ l.n }}</small></p>
            } @empty {
              <p class="home-tile-note">Nothing stands out in the losses yet.</p>
            }
          </div>
        </div>
      } @else {
        <div class="home-tile-empty">
          <span class="material-symbols-rounded" aria-hidden="true">psychology</span>
          <p>Needs {{ a.needs }} wins and {{ a.needs }} losses in Flex prep games to compare — {{ a.wins }} and {{ a.losses }} so far.</p>
        </div>
      }
    </section>
  `
})
export class HomeAdviceComponent {
  readonly advice = input.required<HomeAdvice>();

  private readonly router = inject(Router);

  protected readonly ready = computed(() => {
    const a = this.advice();
    return a.workOn.length > 0 || a.keepDoing.length > 0 || (a.wins >= a.needs && a.losses >= a.needs);
  });

  protected openPatterns(): void {
    void this.router.navigate(['/games'], { queryParams: { tab: 'patterns' } });
  }
}
