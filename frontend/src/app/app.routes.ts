import { Routes } from '@angular/router';
import { authGuard, viewerGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent)
  },
  // One page, three modes. The old paths still resolve rather than redirecting:
  // links and bookmarks keep working, and each names the mode it used to be, so
  // /profiles still opens the table.
  {
    path: 'roster',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/roster/roster.component').then((m) => m.RosterComponent)
  },
  {
    path: 'overview',
    canActivate: [viewerGuard],
    data: { view: 'cards' },
    loadComponent: () => import('./pages/roster/roster.component').then((m) => m.RosterComponent)
  },
  {
    path: 'players',
    canActivate: [viewerGuard],
    data: { view: 'scouting' },
    loadComponent: () => import('./pages/roster/roster.component').then((m) => m.RosterComponent)
  },
  {
    path: 'profiles',
    canActivate: [viewerGuard],
    data: { view: 'table' },
    loadComponent: () => import('./pages/roster/roster.component').then((m) => m.RosterComponent)
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
    path: 'analysis',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/analysis/analysis.component').then((m) => m.AnalysisComponent)
  },
  {
    path: 'review',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/review/review.component').then((m) => m.ReviewComponent)
  },
  {
    path: 'tournaments',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/tournaments/tournaments.component').then((m) => m.TournamentsComponent)
  },
  {
    path: 'synergy',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/synergy/synergy.component').then((m) => m.SynergyComponent)
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
