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

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UserMenuComponent],
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

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.navigating.set(true);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.navigating.set(false);
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
