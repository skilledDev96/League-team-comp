import { Injectable, computed, signal } from '@angular/core';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { isAllowedEmail } from '../core/allowlist';
import { getAuthInstance, isFirebaseConfigured } from '../core/firebase';

const LOCAL_FLAG = 'bom-local-auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly mode: 'firebase' | 'local' = isFirebaseConfigured() ? 'firebase' : 'local';

  readonly userEmail = signal<string | null>(null);
  readonly isAuthed = computed(() => this.userEmail() !== null);

  // Editing requires an allowlisted email in firebase mode; local mode has no backend to guard.
  readonly canEdit = computed(() => {
    const email = this.userEmail();
    if (!email) {
      return false;
    }
    return this.mode === 'local' || isAllowedEmail(email);
  });

  constructor() {
    if (this.mode === 'firebase') {
      const auth = getAuthInstance();
      if (auth) {
        onAuthStateChanged(auth, async (user) => {
          const email = user?.email ?? null;
          this.userEmail.set(email);
          // Sign out anyone who authenticates but isn't on the editor allowlist.
          if (user && !isAllowedEmail(email)) {
            await signOut(auth);
          }
        });
      }
    } else if (sessionStorage.getItem(LOCAL_FLAG)) {
      this.userEmail.set(sessionStorage.getItem(LOCAL_FLAG));
    }
  }

  async login(email: string, password: string): Promise<void> {
    if (this.mode === 'firebase') {
      const auth = getAuthInstance();
      if (!auth) {
        throw new Error('Firebase auth unavailable.');
      }
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await this.enforceAllowlist(credential.user.email);
      return;
    }
    // Local mode: no backend; any non-empty credentials unlock editing for this session.
    if (!email || !password) {
      throw new Error('Enter an email and password.');
    }
    sessionStorage.setItem(LOCAL_FLAG, email);
    this.userEmail.set(email);
  }

  async loginWithGoogle(): Promise<void> {
    if (this.mode !== 'firebase') {
      throw new Error('Google sign-in requires Firebase configuration.');
    }
    const auth = getAuthInstance();
    if (!auth) {
      throw new Error('Firebase auth unavailable.');
    }
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    await this.enforceAllowlist(credential.user.email);
  }

  private async enforceAllowlist(email: string | null): Promise<void> {
    if (isAllowedEmail(email)) {
      return;
    }
    await this.logout();
    throw new Error('This account is not authorized to edit. Ask an admin to add your email.');
  }

  async logout(): Promise<void> {
    if (this.mode === 'firebase') {
      const auth = getAuthInstance();
      if (auth) {
        await signOut(auth);
      }
      return;
    }
    sessionStorage.removeItem(LOCAL_FLAG);
    this.userEmail.set(null);
  }
}
