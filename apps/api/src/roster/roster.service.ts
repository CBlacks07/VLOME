import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClubDto, RosterPlayerDto } from './roster.dto';

/**
 * Base de joueurs (« roster ») et clubs — site-wide, gérée depuis l'admin.
 * Sert à pré-remplir les participants d'un tournoi (assistant de création,
 * étape Participants) sans ressaisir les mêmes noms à chaque fois. Distincte
 * des joueurs *dans* un tournoi (engineState) : la base est une liste de
 * personnes connues, pas un état de compétition.
 */
@Injectable()
export class RosterService {
  constructor(private prisma: PrismaService) {}

  private toPlayerDto(p: { id: string; name: string; city: string | null; elo: number; points: number; clubId: string | null; club: { id: string; name: string; logoUrl: string | null } | null; createdAt: Date }) {
    return {
      id: p.id, name: p.name, city: p.city, elo: p.elo, points: p.points,
      clubId: p.clubId, clubName: p.club?.name ?? null, clubLogoUrl: p.club?.logoUrl ?? null, createdAt: p.createdAt,
    };
  }

  async listPlayers() {
    const rows = await this.prisma.player.findMany({
      orderBy: { name: 'asc' },
      include: { club: { select: { id: true, name: true, logoUrl: true } } },
    });
    return rows.map((p) => this.toPlayerDto(p));
  }

  /** Ajoute un joueur — fusionne (met à jour le club) si un joueur du même nom existe déjà. */
  async addPlayer(dto: RosterPlayerDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Nom requis.');
    const existing = await this.prisma.player.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    const data = { name, city: dto.city?.trim() || null, clubId: dto.clubId || null };
    const row = existing
      ? await this.prisma.player.update({ where: { id: existing.id }, data, include: { club: { select: { id: true, name: true, logoUrl: true } } } })
      : await this.prisma.player.create({ data, include: { club: { select: { id: true, name: true, logoUrl: true } } } });
    return this.toPlayerDto(row);
  }

  async updatePlayer(id: string, dto: RosterPlayerDto) {
    const p = await this.prisma.player.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Joueur introuvable.');
    const row = await this.prisma.player.update({
      where: { id },
      data: { name: dto.name.trim() || p.name, city: dto.city?.trim() || null, clubId: dto.clubId || null },
      include: { club: { select: { id: true, name: true, logoUrl: true } } },
    });
    return this.toPlayerDto(row);
  }

  async removePlayer(id: string) {
    const p = await this.prisma.player.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Joueur introuvable.');
    await this.prisma.player.delete({ where: { id } });
    return { deleted: true };
  }

  async listClubs() {
    const rows = await this.prisma.club.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { players: true } } },
    });
    return rows.map((c) => ({ id: c.id, name: c.name, city: c.city, logoUrl: c.logoUrl, playerCount: c._count.players }));
  }

  async createClub(dto: ClubDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Nom requis.');
    const existing = await this.prisma.club.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (existing) throw new BadRequestException('Un club porte déjà ce nom.');
    const c = await this.prisma.club.create({ data: { name, city: dto.city?.trim() || null, logoUrl: dto.logoUrl || null } });
    return { id: c.id, name: c.name, city: c.city, logoUrl: c.logoUrl, playerCount: 0 };
  }

  async updateClub(id: string, dto: ClubDto) {
    const c = await this.prisma.club.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Club introuvable.');
    const upd = await this.prisma.club.update({
      where: { id },
      data: { name: dto.name.trim() || c.name, city: dto.city?.trim() || null, logoUrl: dto.logoUrl !== undefined ? dto.logoUrl || null : c.logoUrl },
    });
    return { id: upd.id, name: upd.name, city: upd.city, logoUrl: upd.logoUrl };
  }

  async removeClub(id: string) {
    const c = await this.prisma.club.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Club introuvable.');
    // Détache les joueurs avant suppression (ils ne sont pas supprimés, juste "sans club").
    await this.prisma.$transaction([
      this.prisma.player.updateMany({ where: { clubId: id }, data: { clubId: null } }),
      this.prisma.club.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }
}
