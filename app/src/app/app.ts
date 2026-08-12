import { Component, computed, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly data = inject(TeamDataService);
  private readonly router = inject(Router);

  protected readonly navigating = signal(false);
  // Full-screen loader on first paint until initial Firestore data arrives.
  protected readonly initialLoading = computed(() => !this.data.ready());
  // Thin top bar for subsequent route changes.
  protected readonly routeLoading = computed(() => this.navigating() && this.data.ready());

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
  }

  protected onThemeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as Theme;
    this.theme.applyTheme(value);
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
  }
}
