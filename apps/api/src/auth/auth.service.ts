import { BadRequestException, ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

interface UserRow { id: string; email: string; displayName: string; role: string; passwordHash: string; organizerStatus?: string; }

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'miabeapeto@miabe-esport.community';
// Sans ADMIN_PASSWORD fourni, mot de passe aléatoire affiché une seule fois au démarrage : un mot
// de passe par défaut écrit en clair dans le dépôt ouvre l'administration à quiconque le connaît.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  /** Crée un compte ADMIN par défaut au démarrage s'il n'en existe aucun. */
  async onModuleInit() {
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (admin) return;
    const email = ADMIN_EMAIL.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await this.prisma.user.create({ data: { email, passwordHash, displayName: 'Admin Miabe', role: 'ADMIN' } });
    console.log(`[Miabe] Compte ADMIN créé -> ${email} / ${ADMIN_PASSWORD} (à changer)`);
  }

  private sign(u: UserRow) {
    return this.jwt.sign({ sub: u.id, email: u.email, role: u.role });
  }
  private safe(u: UserRow) {
    return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, organizerStatus: u.organizerStatus };
  }

  async register(dto: { email?: string; password?: string; displayName?: string; role?: string; city?: string; favoriteGame?: string; phone?: string; club?: string; organizerNote?: string }) {
    const email = (dto.email || '').trim().toLowerCase();
    if (!email || !dto.password || dto.password.length < 6) {
      throw new BadRequestException('Email et mot de passe (au moins 6 caractères) requis.');
    }
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Cet email est déjà utilisé.');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = dto.role === 'ORGANIZER' ? 'ORGANIZER' : 'PLAYER'; // ADMIN jamais auto-attribué
    const u = await this.prisma.user.create({
      data: {
        email, passwordHash, displayName: (dto.displayName || '').trim() || email.split('@')[0], role,
        city: (dto.city || '').trim() || null,
        favoriteGame: (dto.favoriteGame || '').trim() || null,
        phone: (dto.phone || '').trim() || null,
        // Un compte ORGANIZER doit être validé par l'admin avant de pouvoir créer un tournoi
        // (voir TournamentsService.create) — la demande peut être accompagnée d'une note.
        ...(role === 'ORGANIZER' ? { organizerStatus: 'PENDING', organizerNote: (dto.organizerNote || '').trim() || null } : {}),
      },
    });
    if (role === 'PLAYER') await this.linkRosterPlayer(u.id, u.displayName, u.city, dto.club);
    return { token: this.sign(u), user: this.safe(u) };
  }

  /** Retrouve (insensible à la casse) ou crée le club du catalogue portant ce nom. */
  private async resolveClubId(club?: string): Promise<string | null | undefined> {
    const name = club?.trim();
    if (!name) return club === undefined ? undefined : null; // undefined = ne pas toucher, "" = retirer le club
    const existing = await this.prisma.club.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    return existing ? existing.id : (await this.prisma.club.create({ data: { name } })).id;
  }

  /** Relie (ou crée) l'entrée « base de joueurs » d'un compte Joueur, pour qu'il apparaisse
   * directement en Admin → Joueurs et dans les suggestions de l'assistant de création — sans
   * ressaisie manuelle. Best-effort : ne doit jamais faire échouer l'inscription/connexion. */
  private async linkRosterPlayer(userId: string, name: string, city: string | null, club?: string) {
    try {
      const clubId = await this.resolveClubId(club);
      const existing = await this.prisma.player.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, userId: null } });
      if (existing) await this.prisma.player.update({ where: { id: existing.id }, data: { userId, city: existing.city ?? city, clubId: existing.clubId ?? clubId ?? undefined } });
      else await this.prisma.player.create({ data: { name, city, userId, clubId: clubId || null } });
    } catch (e) {
      console.error('[Miabe] Liaison base de joueurs impossible (inscription non bloquée) :', e);
    }
  }

  async login(dto: { email?: string; password?: string }) {
    const email = (dto.email || '').trim().toLowerCase();
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || !(await bcrypt.compare(dto.password || '', u.passwordHash))) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    return { token: this.sign(u), user: this.safe(u) };
  }
}
