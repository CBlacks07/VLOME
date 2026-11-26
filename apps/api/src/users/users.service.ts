import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as Engine from '@vlome/engine';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, UpdateMeDto } from './users.dto';
import { TournamentsService } from '../tournaments/tournaments.service';
import { ELO_START } from '../tournaments/elo';

/** Le pseudo (displayName) n'est modifiable qu'une fois tous les 30 jours — le club, lui, librement. */
const NAME_CHANGE_COOLDOWN_DAYS = 30;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private tournaments: TournamentsService) {}

  /** Profil complet + statistiques (globales et par jeu) du membre connecté. */
  async me(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, displayName: true, displayNameChangedAt: true, role: true,
        bio: true, avatarUrl: true, city: true, favoriteGame: true, phone: true, createdAt: true, loyaltyPoints: true,
        organizerStatus: true, organizerNote: true, organizerMaxTournaments: true, organizerMaxPlayers: true,
        clubRequested: true, clubStatus: true, clubBlocking: true,
        player: { select: { club: { select: { id: true, name: true } } } },
        ownedClub: { select: { id: true } },
      },
    });
    if (!u) throw new NotFoundException('Utilisateur introuvable');
    const [registrations, orders, tournaments, results] = await Promise.all([
      this.prisma.registration.count({ where: { userId } }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.tournament.count({ where: { createdById: userId } }),
      this.computeResults(userId),
    ]);
    const { player, ownedClub, ...rest } = u;
    return {
      ...rest,
      ownsClub: !!ownedClub, // responsable d'un club : l'interface affiche « Mon club » quel que soit le rôle
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
    const entries = await this.tournaments.accountEntries(userId);
    let totalPoints = 0, totalWins = 0, championships = 0, tournamentsPlayed = 0;
    const breakdown: Array<{ tournamentId: string; tournamentName: string; game: string; status: string; points: number; wins: number; champion: boolean }> = [];
    const byGameMap = new Map<string, { game: string; points: number; wins: number; championships: number; tournamentsPlayed: number }>();
    for (const t of entries) {
      const { st, player } = t;
      const points = Engine.rankingPoints(st)[player.id] || 0;
      const wins = st.log?.filter((l) => l.winner === player.id).length || 0;
      const champion = st.champion === player.id;
      const game = t.game || 'Autre';
      totalPoints += points; totalWins += wins; tournamentsPlayed++;
      if (champion) championships++;
      breakdown.push({
        tournamentId: t.id, tournamentName: t.name, game,
        status: t.status === 'FINISHED' ? 'Terminé' : t.status === 'LIVE' ? 'En direct' : 'À venir',
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
    await this.prisma.user.update({ where: { id: userId }, data });
    // Garde la base de joueurs (Admin → Joueurs) synchro si ce compte y est relié.
    if (data.displayName !== undefined || data.city !== undefined) {
      await this.prisma.player.updateMany({
        where: { userId },
        data: {
          ...(data.displayName !== undefined ? { name: data.displayName as string } : {}),
          ...(data.city !== undefined ? { city: data.city as string | null } : {}),
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
