import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Requires an authorized (signed-in) user; used for viewer-accessible pages.
export const viewerGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitUntilReady();
  if (auth.isAuthed()) {
    return true;
  }
  return router.createUrlTree(['/login']);
};

// Requires edit rights (admin/contributor).
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.waitUntilReady();
  if (auth.canEdit()) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
