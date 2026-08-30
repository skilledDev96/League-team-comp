import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet
} from '@angular/router';
import { AuthService } from './services/auth.service';
import { TeamDataService } from './services/team-data.service';
import { Theme, ThemeService } from './services/theme.service';
import { UserMenuComponent } from './shared/user-menu.component';
import { TooltipDirective } from './shared/tooltip.directive';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UserMenuComponent, TooltipDirective],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(TeamDataService);
  private readonly router = inject(Router);

  protected readonly navigating = signal(false);
  // Full-screen loader only for signed-in users waiting on initial Firestore data.
  protected readonly initialLoading = computed(
    () => this.auth.ready() && this.auth.isAuthed() && !this.data.ready()
  );
  // Thin top bar for subsequent route changes.
  protected readonly routeLoading = computed(() => this.navigating() && this.data.ready());

  protected readonly showTutorial = signal(false);
  private tourChecked = false;

  /**
   * Routes are lazy-loaded, so each one is a separate hashed chunk. After a
   * deploy those filenames change and an already-open tab still asks for the
   * old ones — the fetch 404s and the click appears to do nothing. Reload once
   * so the browser picks up the current index and its chunk names.
   */
  private recoverFromStaleBuild(event: NavigationError): void {
    const message = String((event.error as { message?: string })?.message ?? event.error ?? '');
    const isChunkFailure =
      /dynamically imported module|ChunkLoadError|Loading chunk|Importing a module script failed/i.test(
        message
      );
    if (!isChunkFailure) {
      return;
    }
    // Guard against a reload loop if the chunk is genuinely missing.
    const key = 'bom-stale-build-reload';
    if (sessionStorage.getItem(key) === event.url) {
      return;
    }
    sessionStorage.setItem(key, event.url);
    location.reload();
  }

  constructor() {
    // Publish the scrollbar width so a full-bleed section can break out of the
    // page column without overshooting into a horizontal scrollbar: 100vw
    // counts the scrollbar, the page's own width does not, and the difference
    // is exactly what a `calc(50% - 50vw)` breakout gets wrong.
    const publishScrollbarWidth = () => {
      const width = window.innerWidth - document.documentElement.clientWidth;
      document.documentElement.style.setProperty('--sbw', `${Math.max(0, width)}px`);
    };
    publishScrollbarWidth();
    window.addEventListener('resize', publishScrollbarWidth);
    // A scrollbar appears when the content grows, not when the window changes,
    // so measuring once at startup reads zero and the breakout overshoots by
    // exactly a scrollbar. Watch the body instead.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(publishScrollbarWidth).observe(document.body);
    }

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.navigating.set(true);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel
      ) {
        this.navigating.set(false);
      } else if (event instanceof NavigationError) {
        this.navigating.set(false);
        this.recoverFromStaleBuild(event);
      }
    });

    // Show a one-time welcome tour the first time a user signs in (stored per-account in Firestore).
    effect(() => {
      if (!this.auth.ready()) {
        return;
      }
      if (!this.auth.isAuthed()) {
        this.tourChecked = false;
        return;
      }
      if (this.tourChecked) {
        return;
      }
      this.tourChecked = true;
      void this.auth.hasSeenTour().then((seen) => {
        if (!seen) {
          this.showTutorial.set(true);
        }
      });
    });
  }

  protected dismissTutorial(): void {
    this.showTutorial.set(false);
    void this.auth.markTourSeen();
  }

  protected onThemeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as Theme;
    this.theme.applyTheme(value);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
