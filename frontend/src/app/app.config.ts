import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { ReportingErrorHandler } from './core/error-reporting';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Every uncaught error lands in Firestore beside the draft log, so a
    // "something broke" report the next morning has something to read.
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    provideRouter(routes)
  ]
};
