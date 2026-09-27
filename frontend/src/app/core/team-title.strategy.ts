import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TeamDataService } from '../services/team-data.service';

/**
 * The window title (27 Sep 2026, release 2): the page, then the team, as `Home · Bom Squad`.
 *
 * Until this file the fourteen route titles in app.routes.ts each ended in ` · Bom Squad`, which was the
 * team's name as code. The name is data now: Admin › Settings renames a team and the switcher moves
 * between them, so the routes name the page alone and the team is appended here from TeamDataService's
 * `teamName`, the one accessor every brand reader uses. Signed out that accessor is the public root
 * name, so the login page still reads `Sign in · Bom Squad` and the e2e boot check on the title holds;
 * signed in on another team every page reads that team's name.
 *
 * A rename or a switch happens under a page that is not navigating, so an effect re-applies the last
 * composed title when the name moves. The router's own call sets the title at once, as the default
 * strategy does, and nothing waits on a change-detection turn for the first title after a navigation.
 */

/** `<Page> · <team>`, or the team alone on a route that names no page (none does today). */
export function composeTitle(page: string | undefined, teamName: string): string {
  return page ? `${page} · ${teamName}` : teamName;
}

@Injectable()
export class TeamTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly data = inject(TeamDataService);
  /** The page of the last navigation, as its route names it; null before the first, when index.html's title stands. */
  private readonly route = signal<{ page: string | undefined } | null>(null);

  constructor() {
    super();
    effect(() => {
      const route = this.route();
      const teamName = this.data.teamName();
      if (!route) return;
      untracked(() => this.title.setTitle(composeTitle(route.page, teamName)));
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const page = this.buildTitle(snapshot);
    // A new object every time, so the effect sees a navigation between two routes with the same page title.
    this.route.set({ page });
    this.title.setTitle(composeTitle(page, untracked(() => this.data.teamName())));
  }
}
