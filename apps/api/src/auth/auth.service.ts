import { BadRequestException, ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, escapeHtml } from '../mail/mail.service';

interface UserRow { id: string; email: string; displayName: string; role: string; passwordHash: string; organizerStatus?: string; clubStatus?: string; clubRequested?: string | null; clubBlocking?: boolean; }

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'miabeapeto@miabe-esport.community';
// Sans ADMIN_PASSWORD fourni, mot de passe aléatoire affiché une seule fois au démarrage : un mot
// de passe par défaut écrit en clair dans le dépôt ouvre l'administration à quiconque le connaît.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private prisma: PrismaService, private jwt: JwtService, private mail: MailService) {}

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
    return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, organizerStatus: u.organizerStatus, clubStatus: u.clubStatus, clubRequested: u.clubRequested ?? null, clubBlocking: !!u.clubBlocking };
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
    // Un club saisi à l'inscription n'est PAS enregistré tel quel : il reste une simple demande (clubRequested)
    // que l'admin doit valider, et le compte est bloqué (clubBlocking) d'ici là.
    const requestedClub = role === 'PLAYER' ? (dto.club || '').trim() : '';
    const u = await this.prisma.user.create({
      data: {
        email, passwordHash, displayName: (dto.displayName || '').trim() || email.split('@')[0], role,
        city: (dto.city || '').trim() || null,
        favoriteGame: (dto.favoriteGame || '').trim() || null,
        phone: (dto.phone || '').trim() || null,
        ...(requestedClub ? { clubRequested: requestedClub, clubStatus: 'PENDING', clubBlocking: true } : {}),
        // Un compte ORGANIZER doit être validé par l'admin avant de pouvoir créer un tournoi
        // (voir TournamentsService.create) — la demande peut être accompagnée d'une note.
        ...(role === 'ORGANIZER' ? { organizerStatus: 'PENDING', organizerNote: (dto.organizerNote || '').trim() || null } : {}),
      },
    });
    if (role === 'PLAYER') await this.linkRosterPlayer(u.id, u.displayName, u.city, undefined);
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

  /* ---------- Mot de passe oublié ---------- */

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Envoie un lien de réinitialisation. Répond TOUJOURS la même chose, que l'adresse existe ou non :
   * une réponse différenciée permettrait à un tiers de savoir qui est inscrit sur la plateforme.
   */
  async forgotPassword(email: string) {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (user) {
      // Les demandes précédentes encore valides sont invalidées : un seul lien actif à la fois.
      await this.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() },
      });
      const token = randomBytes(32).toString('base64url');
      await this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: this.hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 heure
        },
      });
      const url = `${this.mail.siteUrl}/#reset=${token}`;
      await this.mail.send(
        user.email,
        'Réinitialise ton mot de passe — Miabe Esport',
        this.mail.layout(
          'Réinitialisation de ton mot de passe',
          `<p>Bonjour ${escapeHtml(user.displayName)},</p>
           <p>Tu as demandé à réinitialiser le mot de passe de ton compte Miabe Esport. Ce lien est valable <b>une heure</b> et ne peut servir qu'une fois.</p>
           <p>Si tu n'es pas à l'origine de cette demande, ignore simplement ce message : ton mot de passe reste inchangé.</p>`,
          { label: 'Choisir un nouveau mot de passe', url },
        ),
      );
    }
    return { sent: true };
  }

  /** Consomme un jeton valide et remplace le mot de passe. */
  async resetPassword(token: string, password: string) {
    const row = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Ce lien de réinitialisation est invalide ou a expiré. Refais une demande.');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    // Connexion immédiate : l'utilisateur vient de prouver qu'il contrôle l'adresse e-mail.
    return { token: this.sign(row.user), user: this.safe(row.user) };
  }

  async login(dto: { email?: string; password?: string }) {
    const id = (dto.email || '').trim();
    const password = dto.password || '';
    let u: Awaited<ReturnType<typeof this.prisma.user.findUnique>> = null;
    if (id.includes('@')) {
      const byMail = await this.prisma.user.findUnique({ where: { email: id.toLowerCase() } });
      if (byMail && (await bcrypt.compare(password, byMail.passwordHash))) u = byMail;
    }
    if (!u) {
      // Pseudo : le nom affiché n'est pas unique, on retient le compte dont le mot de passe correspond
      // (plafonné pour ne pas transformer la route en boucle de hachages).
      const candidates = await this.prisma.user.findMany({ where: { displayName: { equals: id, mode: 'insensitive' } }, take: 5 });
      for (const c of candidates) {
        if (await bcrypt.compare(password, c.passwordHash)) { u = c; break; }
      }
    }
    if (!u) throw new UnauthorizedException('Identifiants invalides.');
    return { token: this.sign(u), user: this.safe(u) };
  }
}
