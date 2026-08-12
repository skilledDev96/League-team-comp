import { Routes } from '@angular/router';
import { authGuard, viewerGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'overview',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/overview/overview.component').then((m) => m.OverviewComponent)
  },
  {
    path: 'players',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/player-intel/player-intel.component').then((m) => m.PlayerIntelComponent)
  },
  {
    path: 'player/:id',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/player-profile/player-profile.component').then((m) => m.PlayerProfileComponent)
  },
  {
    path: 'comps',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/comps/comps.component').then((m) => m.CompsComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent)
  },
  { path: '**', redirectTo: '' }
];
