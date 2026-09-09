import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { PlayerEditorService } from '../../services/player-editor.service';
import { Player, Role, ROLES } from '../../models/team.models';
import { UiService } from '../../services/ui.service';
import { ChampionChipComponent } from '../../shared/champion-chip.component';
import { ExternalProfilesComponent } from '../../shared/external-profiles.component';
import { PlayerAvatarComponent } from '../../shared/player-avatar.component';
import { TooltipDirective } from '../../shared/tooltip.directive';

@Component({
  selector: 'app-overview',
  imports: [NgTemplateOutlet, RouterLink, PlayerAvatarComponent, ChampionChipComponent, ExternalProfilesComponent, TooltipDirective],
  templateUrl: './overview.component.html'
})
export class OverviewComponent {
  /** Hosted inside the Roster page, which supplies the heading and the mode switch. */
  readonly embedded = input(false);

  protected readonly data = inject(TeamDataService);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  protected readonly editor = inject(PlayerEditorService);
  protected readonly roles = ROLES;

  private bySeat(list: readonly Player[]): Player[] {
    return [...list].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.order - b.order);
  }

  /** The five the draft room follows, Top to Support. */
  protected readonly starters = computed(() => this.bySeat(this.data.players().filter((p) => !p.sub)));
  /** The bench, in the same order. */
  protected readonly subs = computed(() => this.bySeat(this.data.players().filter((p) => !!p.sub)));

  // ---- The A team and the second seats, set here because this is where the
  // team looks at itself; Patterns reads both (8 Sep 2026). The same sub
  // flag Admin sets, so the five stay one thing everywhere.

  protected setBench(player: Player, sub: boolean): void {
    void this.editor.patch(player, { sub: sub || undefined });
  }

  protected hasSecondary(player: Player, role: Role): boolean {
    return (player.secondaryRoles ?? []).includes(role);
  }

  /** The seat in the title. A second seat that becomes the main stops being a second. */
  protected setMain(player: Player, role: Role): void {
    if (role === player.role) return;
    const seconds = (player.secondaryRoles ?? []).filter((r) => r !== role);
    void this.editor.patch(player, { role, secondaryRoles: seconds.length ? seconds : undefined });
  }

  protected toggleSecondary(player: Player, role: Role): void {
    if (role === player.role) return;
    const now = player.secondaryRoles ?? [];
    const next = now.includes(role) ? now.filter((r) => r !== role) : [...now, role];
    void this.editor.patch(player, { secondaryRoles: next.length ? next : undefined });
  }

  /** Full adds the team identity, the fill-ins and the links; the shell's toolbar sets it. */
  readonly full = input(false);
  private readonly expanded = signal<Set<string>>(new Set());

  protected readonly resourceGroups = computed(() => Object.entries(this.data.resourceLinks()));
  protected readonly resourceIcon: Record<string, string> = {
    DraftTools: 'DT',
    MacroAndObjectives: 'MO',
    MatchupResearch: 'MR'
  };
  protected readonly resourceIconSymbol: Record<string, string> = {
    DraftTools: 'construction',
    MacroAndObjectives: 'map',
    MatchupResearch: 'query_stats'
  };

  protected isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  protected toggle(id: string): void {
    const next = new Set(this.expanded());
    next.has(id) ? next.delete(id) : next.add(id);
    this.expanded.set(next);
  }

  protected groupLabel(group: string): string {
    return group.replace(/([A-Z])/g, ' $1').trim();
  }
}
