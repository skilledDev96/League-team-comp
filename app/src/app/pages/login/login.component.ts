import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly mode = this.auth.mode;

  constructor() {
    // After a Google redirect returns here, send authorized users to the editor.
    effect(() => {
      if (this.auth.canEdit()) {
        void this.router.navigate(['/admin']);
      }
    });
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.login(this.email(), this.password());
      await this.router.navigate(['/admin']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async googleSignIn(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.loginWithGoogle();
      await this.router.navigate(['/admin']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      this.busy.set(false);
    }
  }
}
