import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, TitleStrategy } from '@angular/router';

import { routes } from './app.routes';
import { ReportingErrorHandler } from './core/error-reporting';
import { TeamTitleStrategy } from './core/team-title.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Every uncaught error lands in Firestore beside the draft log, so a
    // "something broke" report the next morning has something to read.
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    provideRouter(routes),
    // The window title is the page and the team, and follows the team's name (27 Sep 2026, release 2).
    { provide: TitleStrategy, useClass: TeamTitleStrategy }
  ]
};
