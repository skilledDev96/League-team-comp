import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { authGuard, viewerGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    title: 'Sign in · Bom Squad',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent)
  },
  {
    // The landing page (13 Sep 2026): the team, the season, the next series and the MVP race.
    path: 'home',
    title: 'Home · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/home/home.component').then((m) => m.HomeComponent)
  },
  // One page, three modes. The old paths still resolve rather than redirecting:
  // links and bookmarks keep working, and each names the mode it used to be, so
  // /profiles still opens the table.
  {
    path: 'roster',
    title: 'Roster · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/roster/roster.component').then((m) => m.RosterComponent)
  },
  // Sign-in used to land on /overview, Roster's Cards view. Home is the landing page now (13 Sep 2026),
  // and a bookmark of the old landing lands on the new one.
  { path: 'overview', redirectTo: 'home' },
  {
    path: 'players',
    title: 'Roster · Bom Squad',
    canActivate: [viewerGuard],
    data: { view: 'players' },
    loadComponent: () => import('./pages/roster/roster.component').then((m) => m.RosterComponent)
  },
  {
    path: 'profiles',
    title: 'Roster · Bom Squad',
    canActivate: [viewerGuard],
    data: { view: 'players' },
    loadComponent: () => import('./pages/roster/roster.component').then((m) => m.RosterComponent)
  },
  {
    path: 'player/:id',
    title: 'Player · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/player-profile/player-profile.component').then((m) => m.PlayerProfileComponent)
  },
  {
    path: 'comps',
    title: 'Comps · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/comps/comps.component').then((m) => m.CompsComponent)
  },
  {
    // Every game we played, from every source, with Review folded in as its
    // Patterns tab (8 Sep 2026). The two old paths still resolve so links in
    // notes and the e2e suite land where they always did.
    path: 'games',
    title: 'Games · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/games/games.component').then((m) => m.GamesComponent)
  },
  {
    path: 'analysis',
    title: 'Games · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/games/games.component').then((m) => m.GamesComponent)
  },
  {
    path: 'review',
    title: 'Games · Bom Squad',
    canActivate: [viewerGuard],
    data: { tab: 'patterns' },
    loadComponent: () => import('./pages/games/games.component').then((m) => m.GamesComponent)
  },
  {
    // The Scrims page folded into Prep & Draft (9 Sep 2026): every scrim
    // opponent is a series in the scrims group there. Old links still land.
    path: 'scrims',
    redirectTo: () => inject(Router).createUrlTree(['/tournaments'], { queryParams: { view: 'plan', group: 'scrims' } })
  },
  {
    path: 'tournaments',
    title: 'Prep & Draft · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/tournaments/tournaments.component').then((m) => m.TournamentsComponent)
  },
  {
    path: 'synergy',
    title: 'Synergy · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/synergy/synergy.component').then((m) => m.SynergyComponent)
  },
  {
    path: 'login',
    title: 'Sign in · Bom Squad',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'admin',
    title: 'Admin · Bom Squad',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/admin/admin.component').then((m) => m.AdminComponent)
  },
  {
    // The film room (9 Sep 2026): one review walked as chapters, opened from
    // a game row's poster. ?c=<chapter kind or index> picks the chapter.
    path: 'film/:matchId',
    title: 'Film room · Bom Squad',
    canActivate: [viewerGuard],
    loadComponent: () => import('./pages/film/film.component').then((m) => m.FilmComponent)
  },
  { path: '**', redirectTo: '' }
];
