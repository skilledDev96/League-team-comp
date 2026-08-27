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
    path: 'profiles',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/profiles/team-profiles.component').then((m) => m.TeamProfilesComponent)
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
