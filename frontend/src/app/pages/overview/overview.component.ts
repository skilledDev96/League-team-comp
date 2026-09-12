import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TeamDataService } from '../../services/team-data.service';
import { PlayerEditorService } from '../../services/player-editor.service';
import { FillIn, Player, Role, ROLES } from '../../models/team.models';
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
  /** A fill-in in a player's clothes, so the same card renders them; the seat is their first preferred role. */
  protected readonly fillInCards = computed<(Player & { fillIn: FillIn })[]>(() =>
    this.data.fillIns().map((f) => {
      const [first, ...rest] = f.preferredRoles.filter((r): r is Role => (ROLES as readonly string[]).includes(r));
      return {
        id: `fill-${f.id}`,
        name: f.summoner,
        role: first ?? 'Top',
        secondaryRoles: rest.length ? rest : undefined,
        icon: f.icon,
        playstyle: f.riot?.playstyle,
        strengths: f.riot?.strengths ?? [],
        weaknesses: f.riot?.weaknesses ?? [],
        top3: f.riot?.top3 ?? [],
        bans: [],
        queueStats: f.riot?.queueStats,
        profile: f.profile,
        order: f.order,
        fillIn: f
      };
    })
  );

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

  /**
   * Full opens every card's Quick look; the shell's switch sets it (12 Sep 2026).
   *
   * It used to add the Team Identity card, a Quick Access card and the Macro, Research and Draft
   * Tools links. The lead: "we are not using those tools." Nothing in the app edits either the
   * identity or the links — both are the original seed — and the real quick actions already sit
   * above every view, so Full now means what it means everywhere else: the same things, expanded.
   */
  readonly full = input(false);

  /** Cards turned against the depth: the open ones at Starter, the shut ones at Full. */
  private readonly flipped = signal<ReadonlySet<string>>(new Set());
  private readonly resetFlips = effect(() => {
    this.full();
    untracked(() => this.flipped.set(new Set()));
  });

  protected isExpanded(id: string): boolean {
    return this.full() !== this.flipped().has(id);
  }

  protected toggle(id: string): void {
    this.flipped.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
}
