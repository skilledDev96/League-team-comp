import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Where to go after signing in.
 *
 * A shared draft link points at a series and game; without this the guard
 * sent a signed-out teammate to the login page and, after signing in, to the
 * overview — so the link they were sent never opened what it named.
 */
function toLogin(router: Router, returnUrl: string) {
  const queryParams = returnUrl && returnUrl !== '/' && !returnUrl.startsWith('/login') ? { returnUrl } : {};
  return router.createUrlTree(['/login'], { queryParams });
}

// Requires an authorized (signed-in) user; used for viewer-accessible pages.
export const viewerGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitUntilReady();
  if (auth.isAuthed()) {
    return true;
  }
  return toLogin(router, state.url);
};

// Requires edit rights (admin/contributor).
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitUntilReady();
  if (auth.canEdit()) {
    return true;
  }
  return toLogin(router, state.url);
};
