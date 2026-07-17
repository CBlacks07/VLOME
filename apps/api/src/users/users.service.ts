import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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
    const [registrations, orders, tournaments] = await Promise.all([
      this.prisma.registration.count({ where: { userId } }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.tournament.count({ where: { createdById: userId } }),
    ]);
    return { ...u, stats: { registrations, orders, tournaments } };
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
