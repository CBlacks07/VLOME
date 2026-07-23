import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as Engine from '@vlome/engine';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, UpdateMeDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /** Profil complet + statistiques du membre connecté. */
  async me(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, displayName: true, role: true,
        bio: true, city: true, favoriteGame: true, createdAt: true,
      },
    });
    if (!u) throw new NotFoundException('Utilisateur introuvable');
    const [registrations, orders, tournaments, results] = await Promise.all([
      this.prisma.registration.count({ where: { userId } }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.tournament.count({ where: { createdById: userId } }),
      this.computeResults(userId),
    ]);
    return { ...u, stats: { registrations, orders, tournaments, ...results.totals } };
  }

  /**
   * Statistiques réelles calculées depuis l'état du moteur des tournois joués
   * (points, victoires, titres) — aucune saisie manuelle, tout vient des résultats.
   */
  private async computeResults(userId: string) {
    const regs = await this.prisma.registration.findMany({
      where: { userId, paymentStatus: 'paid' },
      include: { tournament: { select: { id: true, name: true, status: true, engineState: true } } },
    });
    let totalPoints = 0, totalWins = 0, championships = 0, tournamentsPlayed = 0;
    const breakdown: Array<{ tournamentId: string; tournamentName: string; status: string; points: number; wins: number; champion: boolean }> = [];
    for (const r of regs) {
      const st = r.tournament.engineState as unknown as Engine.Tournament | null;
      if (!st) continue;
      const player = st.players?.find((p) => p.name === r.playerName);
      if (!player) continue;
      const points = st.points?.[player.id] || 0;
      const wins = st.log?.filter((l) => l.winner === player.id).length || 0;
      const champion = st.champion === player.id;
      totalPoints += points; totalWins += wins; tournamentsPlayed++;
      if (champion) championships++;
      breakdown.push({
        tournamentId: r.tournament.id, tournamentName: r.tournament.name,
        status: r.tournament.status === 'FINISHED' ? 'Terminé' : r.tournament.status === 'LIVE' ? 'En direct' : 'À venir',
        points, wins, champion,
      });
    }
    return { totals: { totalPoints, totalWins, championships, tournamentsPlayed }, breakdown };
  }

  /** Historique détaillé des résultats par tournoi, pour l'onglet stats du profil. */
  async myResults(userId: string) {
    const { breakdown } = await this.computeResults(userId);
    return breakdown.sort((a, b) => b.points - a.points);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const data: Record<string, unknown> = {};
    if (dto.displayName !== undefined) {
      const name = dto.displayName.trim();
      if (!name) throw new BadRequestException('Le nom affiché ne peut pas être vide.');
      data.displayName = name;
    }
    if (dto.bio !== undefined) data.bio = dto.bio.trim() || null;
    if (dto.city !== undefined) data.city = dto.city.trim() || null;
    if (dto.favoriteGame !== undefined) data.favoriteGame = dto.favoriteGame.trim() || null;
    await this.prisma.user.update({ where: { id: userId }, data });
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
}
