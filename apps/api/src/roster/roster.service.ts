import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { uniqueClubSlug } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MembershipService } from '../associations/membership.service';
import { AssociationsService } from '../associations/associations.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { ClubDto, GameDto, RosterPlayerDto } from './roster.dto';

/**
 * Base de joueurs (« roster ») et clubs — site-wide, gérée depuis l'admin.
 * Sert à pré-remplir les participants d'un tournoi (assistant de création,
 * étape Participants) sans ressaisir les mêmes noms à chaque fois. Distincte
 * des joueurs *dans* un tournoi (engineState) : la base est une liste de
 * personnes connues, pas un état de compétition.
 */
@Injectable()
export class RosterService {
  constructor(private prisma: PrismaService, private users: UsersService, private tournaments: TournamentsService, private membership: MembershipService, private associations: AssociationsService) {}

  private toPlayerDto(p: { id: string; name: string; city: string | null; userId?: string | null; user?: { avatarUrl: string | null } | null; clubId: string | null; club: { id: string; name: string; logoUrl: string | null } | null; createdAt: Date }, totals?: { points: number; matches: number; titles?: number }) {
    return {
      // points/matchs : RÉELS (calculés sur les tournois joués), pas les anciennes colonnes de la base qui n'ont jamais été alimentées.
      id: p.id, name: p.name, city: p.city, points: totals?.points ?? 0, matches: totals?.matches ?? 0, titles: totals?.titles ?? 0,
      avatarUrl: p.user?.avatarUrl ?? null, hasAccount: !!p.userId, clubId: p.clubId, clubName: p.club?.name ?? null, clubLogoUrl: p.club?.logoUrl ?? null, createdAt: p.createdAt,
    };
  }

  async listPlayers() {
    const rows = await this.prisma.player.findMany({
      orderBy: { name: 'asc' },
      include: { club: { select: { id: true, name: true, logoUrl: true } }, user: { select: { avatarUrl: true } } },
    });
    const totals = await this.tournaments.playerStats(rows);
    return rows.map((p) => this.toPlayerDto(p, totals.get(p.id)));
  }

  /** Ajoute un joueur — fusionne (met à jour la ville et le club) si un joueur du même nom existe déjà. Le club passe par
   *  MembershipService, pour laisser la même trace qu'une adhésion. */
  async addPlayer(dto: RosterPlayerDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Nom requis.');
    const existing = await this.prisma.player.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    const data = { name, city: dto.city?.trim() || null };
    const row = existing
      ? await this.prisma.player.update({ where: { id: existing.id }, data })
      : await this.prisma.player.create({ data });
    // Sans club choisi, un joueur déjà connu garde le sien.
    if (dto.clubId) await this.membership.adminSetClub(row.id, dto.clubId);
    return this.dtoById(row.id);
  }

  async updatePlayer(id: string, dto: RosterPlayerDto) {
    const p = await this.prisma.player.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Joueur introuvable.');
    await this.prisma.player.update({ where: { id }, data: { name: dto.name.trim() || p.name, city: dto.city?.trim() || null } });
    await this.membership.adminSetClub(id, dto.clubId || null);
    return this.dtoById(id);
  }

  private async dtoById(id: string) {
    const row = await this.prisma.player.findUnique({ where: { id }, include: { club: { select: { id: true, name: true, logoUrl: true } }, user: { select: { avatarUrl: true } } } });
    if (!row) throw new NotFoundException('Joueur introuvable.');
    return this.toPlayerDto(row);
  }

  async removePlayer(id: string) {
    const p = await this.prisma.player.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Joueur introuvable.');
    await this.prisma.player.delete({ where: { id } });
    return { deleted: true };
  }

  /** Vue complète d'un joueur de la base pour l'admin : fiche roster + (si un compte y est relié)
   * tout ce à quoi il est rattaché sur le site — stats globales et par jeu, commandes, inscriptions. */
  async playerDetail(id: string) {
    const p = await this.prisma.player.findUnique({ where: { id }, include: { club: { select: { id: true, name: true, logoUrl: true } }, user: { select: { avatarUrl: true } } } });
    if (!p) throw new NotFoundException('Joueur introuvable.');
    const base = this.toPlayerDto(p, (await this.tournaments.playerStats([p])).get(p.id));
    if (!p.userId) return { ...base, linked: false };
    const profile = await this.users.profileForAdmin(p.userId);
    return { ...base, linked: true, account: profile };
  }

  async listClubs() {
    const rows = await this.prisma.club.findMany({
      where: { status: 'APPROVED' },
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
    const c = await this.prisma.club.create({ data: { name, slug: await uniqueClubSlug(this.prisma, name), city: dto.city?.trim() || null, logoUrl: dto.logoUrl || null } });
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

  removeClub(id: string) {
    return this.associations.removeClub(id);
  }

  /* ---------- Catalogue des jeux ---------- */

  async listGames() {
    const rows = await this.prisma.game.findMany({ orderBy: { name: 'asc' } });
    return rows.map((g) => ({ id: g.id, name: g.name, imageUrl: g.imageUrl }));
  }

  async createGame(dto: GameDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Nom requis.');
    const existing = await this.prisma.game.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (existing) throw new BadRequestException('Ce jeu est déjà dans le catalogue.');
    const g = await this.prisma.game.create({ data: { name, imageUrl: dto.imageUrl || null } });
    return { id: g.id, name: g.name, imageUrl: g.imageUrl };
  }

  async updateGame(id: string, dto: GameDto) {
    const g = await this.prisma.game.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Jeu introuvable.');
    const name = dto.name.trim() || g.name;
    const existing = await this.prisma.game.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id } } });
    if (existing) throw new BadRequestException('Ce jeu est déjà dans le catalogue.');
    // Sans image dans la demande, on garde l'actuelle ; une chaîne vide la retire.
    const upd = await this.prisma.game.update({ where: { id }, data: { name, ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl || null } : {}) } });
    return { id: upd.id, name: upd.name, imageUrl: upd.imageUrl };
  }

  async removeGame(id: string) {
    const g = await this.prisma.game.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Jeu introuvable.');
    await this.prisma.game.delete({ where: { id } });
    return { deleted: true };
  }
}
