import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

/**
 * The way in: Sign in with Google, and nothing else on the page (9 Sep 2026;
 * the email and password form went, nobody used it). Local mode gets one
 * button instead. A sign-in token on the fragment (`/#token=…`) is the
 * automated test user's door: minted by the test runner from a service
 * account, never typed, cleared from the address bar before it is used.
 */
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly mode = this.auth.mode;

  constructor() {
    // After sign-in, back to whatever the person was sent — a shared draft
    // link, say — and otherwise the overview.
    effect(() => {
      if (!this.auth.isAuthed()) {
        return;
      }
      void this.router.navigateByUrl(this.destination());
    });

    const token = this.tokenFromFragment();
    if (token) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      void this.tokenSignIn(token);
    }
  }

  /** Only a path on this site; anything else is ignored rather than followed. */
  private destination(): string {
    const wanted = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    return wanted.startsWith('/') && !wanted.startsWith('//') ? wanted : '/overview';
  }

  private tokenFromFragment(): string | null {
    const fragment = this.route.snapshot.fragment ?? window.location.hash.replace(/^#/, '');
    if (!fragment) return null;
    return new URLSearchParams(fragment).get('token');
  }

  private async run(action: () => Promise<void>, fallback: string): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await action();
      await this.router.navigateByUrl(this.destination());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : fallback);
    } finally {
      this.busy.set(false);
    }
  }

  protected googleSignIn(): Promise<void> {
    return this.run(() => this.auth.loginWithGoogle(), 'Google sign-in failed.');
  }

  protected enterLocal(): Promise<void> {
    return this.run(async () => this.auth.enterLocal(), 'Could not start the local preview.');
  }

  private tokenSignIn(token: string): Promise<void> {
    return this.run(() => this.auth.loginWithToken(token), 'The sign-in token was refused.');
  }
}
