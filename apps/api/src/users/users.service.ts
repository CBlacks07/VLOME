import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as Engine from '@vlome/engine';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, UpdateMeDto } from './users.dto';
import { AssociationsService } from '../associations/associations.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { ELO_START } from '../tournaments/elo';

/** Le pseudo (displayName) n'est modifiable qu'une fois tous les 30 jours — le club, lui, librement. */
const NAME_CHANGE_COOLDOWN_DAYS = 30;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private assoc: AssociationsService, private tournaments: TournamentsService) {}

  /** Profil complet + statistiques (globales et par jeu) du membre connecté. */
  async me(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, displayName: true, displayNameChangedAt: true, role: true,
        bio: true, city: true, favoriteGame: true, phone: true, createdAt: true, loyaltyPoints: true,
        organizerStatus: true, organizerNote: true, organizerMaxTournaments: true, organizerMaxPlayers: true,
        clubRequested: true, clubStatus: true, clubBlocking: true,
        player: { select: { club: { select: { id: true, name: true } } } },
      },
    });
    if (!u) throw new NotFoundException('Utilisateur introuvable');
    const [registrations, orders, tournaments, results] = await Promise.all([
      this.prisma.registration.count({ where: { userId } }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.tournament.count({ where: { createdById: userId } }),
      this.computeResults(userId),
    ]);
    const { player, ...rest } = u;
    return {
      ...rest,
      clubId: player?.club?.id ?? null,
      clubName: player?.club?.name ?? null,
      nextNameChangeAt: this.nextNameChangeAt(u.displayNameChangedAt),
      stats: { registrations, orders, tournaments, ...results.totals, byGame: results.byGame },
    };
  }

  private nextNameChangeAt(changedAt: Date | null): string | null {
    if (!changedAt) return null;
    const next = new Date(changedAt.getTime() + NAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    return next > new Date() ? next.toISOString() : null;
  }

  /**
   * Statistiques réelles calculées depuis l'état du moteur des tournois joués (points, victoires,
   * titres) — aucune saisie manuelle, tout vient des résultats. Aussi regroupées par jeu, pour que
   * le joueur (et l'admin) voient sa performance jeu par jeu, pas seulement un total global.
   */
  private async computeResults(userId: string) {
    const regs = await this.prisma.registration.findMany({
      where: { userId, paymentStatus: 'paid' },
      include: { tournament: { select: { id: true, name: true, game: true, status: true, engineState: true } } },
    });
    let totalPoints = 0, totalWins = 0, championships = 0, tournamentsPlayed = 0;
    const breakdown: Array<{ tournamentId: string; tournamentName: string; game: string; status: string; points: number; wins: number; champion: boolean }> = [];
    const byGameMap = new Map<string, { game: string; points: number; wins: number; championships: number; tournamentsPlayed: number }>();
    for (const r of regs) {
      const st = r.tournament.engineState as unknown as Engine.Tournament | null;
      if (!st) continue;
      const player = st.players?.find((p) => p.name === r.playerName);
      if (!player) continue;
      const points = st.points?.[player.id] || 0;
      const wins = st.log?.filter((l) => l.winner === player.id).length || 0;
      const champion = st.champion === player.id;
      const game = r.tournament.game || 'Autre';
      totalPoints += points; totalWins += wins; tournamentsPlayed++;
      if (champion) championships++;
      breakdown.push({
        tournamentId: r.tournament.id, tournamentName: r.tournament.name, game,
        status: r.tournament.status === 'FINISHED' ? 'Terminé' : r.tournament.status === 'LIVE' ? 'En direct' : 'À venir',
        points, wins, champion,
      });
      const g = byGameMap.get(game) || { game, points: 0, wins: 0, championships: 0, tournamentsPlayed: 0 };
      g.points += points; g.wins += wins; g.tournamentsPlayed++;
      if (champion) g.championships++;
      byGameMap.set(game, g);
    }
    const elos = await this.tournaments.playerElos('', userId);
    const byGame = Array.from(byGameMap.values()).map((g) => ({ ...g, elo: elos.get(g.game) ?? ELO_START })).sort((a, b) => b.points - a.points);
    return { totals: { totalPoints, totalWins, championships, tournamentsPlayed }, breakdown, byGame };
  }

  /** Historique détaillé des résultats par tournoi, pour l'onglet stats du profil. */
  async myResults(userId: string) {
    const { breakdown } = await this.computeResults(userId);
    return breakdown.sort((a, b) => b.points - a.points);
  }

  /** Retrouve (insensible à la casse) ou crée le club du catalogue portant ce nom. */
  private async resolveClubId(name: string): Promise<string | null> {
    if (!name) return null;
    const existing = await this.prisma.club.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    return existing ? existing.id : (await this.prisma.club.create({ data: { name } })).id;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const current = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayNameChangedAt: true, displayName: true } });
    if (!current) throw new NotFoundException('Utilisateur introuvable');
    const data: Record<string, unknown> = {};
    if (dto.displayName !== undefined) {
      const name = dto.displayName.trim();
      if (!name) throw new BadRequestException('Le nom affiché ne peut pas être vide.');
      const waitUntil = this.nextNameChangeAt(current.displayNameChangedAt);
      if (waitUntil) {
        throw new BadRequestException(`Le pseudo n'est modifiable qu'une fois par mois — réessaie à partir du ${new Date(waitUntil).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}.`);
      }
      data.displayName = name;
      data.displayNameChangedAt = new Date();
    }
    if (dto.bio !== undefined) data.bio = dto.bio.trim() || null;
    if (dto.city !== undefined) data.city = dto.city.trim() || null;
    if (dto.favoriteGame !== undefined) data.favoriteGame = dto.favoriteGame.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    // Club : retirer le sien est immédiat ; en changer ou en choisir un est une DEMANDE, validée par un admin
    // avant d'entrer dans le catalogue et sur la fiche joueur (le club actuel reste en place d'ici là).
    let clubId: string | null | undefined;
    let joinRequest: string | null = null; // club visé par une NOUVELLE demande d'adhésion (l'association en est prévenue par e-mail)
    if (dto.club !== undefined) {
      const wanted = dto.club.trim();
      if (!wanted) {
        clubId = null;
        Object.assign(data, { clubRequested: null, clubRequestedId: null, clubStatus: 'NONE' });
      } else {
        const target = await this.prisma.club.findFirst({ where: { name: { equals: wanted, mode: 'insensitive' }, status: 'APPROVED' }, select: { id: true, name: true } });
        if (!target) throw new BadRequestException('Choisis un club de la liste des associations validées.');
        const player = await this.prisma.player.findFirst({ where: { userId }, select: { club: { select: { name: true } } } });
        if ((player?.club?.name || '').toLowerCase() !== target.name.toLowerCase()) {
          // C'est l'association du club qui valide l'adhésion (voir AssociationsService.reviewMember).
          Object.assign(data, { clubRequested: target.name, clubRequestedId: target.id, clubStatus: 'PENDING' });
          joinRequest = target.id;
        }
      }
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    if (joinRequest) await this.assoc.notifyJoinRequest(joinRequest, (data.displayName as string | undefined) ?? current.displayName);
    // Garde la base de joueurs (Admin → Joueurs) synchro si ce compte y est relié.
    if (data.displayName !== undefined || data.city !== undefined || clubId !== undefined) {
      await this.prisma.player.updateMany({
        where: { userId },
        data: {
          ...(data.displayName !== undefined ? { name: data.displayName as string } : {}),
          ...(data.city !== undefined ? { city: data.city as string | null } : {}),
          ...(clubId !== undefined ? { clubId } : {}),
        },
      }).catch(() => { /* best-effort */ });
    }
    return this.me(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('Utilisateur introuvable');
    if (!(await bcrypt.compare(dto.currentPassword, u.passwordHash))) {
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { changed: true };
  }

  /** Mes inscriptions aux tournois (avec l'état du tournoi). */
  async myRegistrations(userId: string) {
    const regs = await this.prisma.registration.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { tournament: { select: { id: true, name: true, game: true, status: true, date: true, place: true } } },
    });
    return regs.map((r) => ({
      id: r.id,
      playerName: r.playerName,
      createdAt: r.createdAt,
      amountXof: r.amountXof,
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      tournament: {
        id: r.tournament.id,
        name: r.tournament.name,
        game: r.tournament.game || '',
        status: r.tournament.status === 'FINISHED' ? 'Terminé' : r.tournament.status === 'LIVE' ? 'En direct' : 'À venir',
        live: r.tournament.status === 'LIVE',
        date: r.tournament.date ? new Date(r.tournament.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '',
        place: r.tournament.place || '',
      },
    }));
  }

  /** Mes commandes boutique. */
  myOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, reference: true, totalXof: true, paymentMethod: true, status: true, items: true, createdAt: true },
    });
  }

  /** Vue complète d'un compte pour l'admin (Admin → Joueurs → Voir le profil) : mêmes stats
   * (globales + par jeu) que "Mon espace", plus commandes et inscriptions — tout ce à quoi le
   * joueur est rattaché sur le site, visible aussi côté admin. */
  async profileForAdmin(userId: string) {
    const [profile, orders, registrations] = await Promise.all([
      this.me(userId),
      this.myOrders(userId),
      this.myRegistrations(userId),
    ]);
    return { ...profile, orders, registrations };
  }
}
