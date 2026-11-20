import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, escapeHtml } from '../mail/mail.service';
import { UpdateAssociationDto } from './associations.dto';
import { TournamentsService } from '../tournaments/tournaments.service';

const MAX_PUBLIC_TOURNAMENTS = 40;
const TOURNAMENT_SELECT = { id: true, name: true, game: true, status: true, date: true, place: true, imageUrl: true } as const;

@Injectable()
export class AssociationsService {
  constructor(private prisma: PrismaService, private mail: MailService, private tournaments: TournamentsService) {}

  /** Points / victoires / matchs RÉELS de chaque membre (tous jeux confondus), calculés sur les tournois — pas les colonnes de la base, jamais alimentées. */
  private async withStats<T extends { name: string }>(players: T[]) {
    const totals = await this.tournaments.playerTotals();
    return players
      .map((p) => ({ p, t: totals.get(p.name.toLowerCase()) ?? { points: 0, wins: 0, matches: 0 } }))
      .sort((x, y) => y.t.points - x.t.points || y.t.wins - x.t.wins || x.p.name.localeCompare(y.p.name))
      .map(({ p, t }) => ({ ...p, points: t.points, wins: t.wins, matches: t.matches }));
  }

  /** Clubs validés, proposés dans la liste de l'inscription et du profil joueur (lecture publique). */
  publicClubs() {
    return this.prisma.club.findMany({ where: { status: 'APPROVED' }, orderBy: { name: 'asc' }, select: { id: true, name: true, city: true, logoUrl: true, slug: true } });
  }

  private async clubOf(ownerId: string) {
    const club = await this.prisma.club.findUnique({ where: { ownerId } });
    if (!club) throw new NotFoundException("Aucune association n'est rattachée à ce compte.");
    return club;
  }

  private toProfile(c: { id: string; name: string; slug: string | null; city: string | null; logoUrl: string | null; website: string | null; description: string | null; contactEmail: string | null; status: string }) {
    return { id: c.id, name: c.name, slug: c.slug, city: c.city, logoUrl: c.logoUrl, website: c.website, description: c.description, contactEmail: c.contactEmail, status: c.status };
  }

  /** Espace « Mon club » : profil, demandes d'adhésion en attente, membres. */
  async me(ownerId: string) {
    const club = await this.clubOf(ownerId);
    const [pending, members] = await Promise.all([
      this.prisma.user.findMany({
        where: { clubRequestedId: club.id, clubStatus: 'PENDING' }, orderBy: { createdAt: 'asc' },
        select: { id: true, displayName: true, email: true, city: true, createdAt: true },
      }),
      this.prisma.player.findMany({ where: { clubId: club.id }, select: { id: true, name: true, city: true, userId: true } }),
    ]);
    const ranked = await this.withStats(members);
    return { club: this.toProfile(club), pending, members: ranked.map((m) => ({ id: m.id, name: m.name, city: m.city, points: m.points, wins: m.wins, matches: m.matches, hasAccount: !!m.userId })) };
  }

  async updateMe(ownerId: string, dto: UpdateAssociationDto) {
    const club = await this.clubOf(ownerId);
    const clean = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
    const website = clean(dto.website);
    if (website && !/^https?:\/\//i.test(website)) throw new BadRequestException('Le site web doit commencer par http:// ou https://');
    const upd = await this.prisma.club.update({
      where: { id: club.id },
      data: {
        ...(dto.city !== undefined ? { city: clean(dto.city) } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: clean(dto.logoUrl) } : {}),
        ...(website !== undefined ? { website } : {}),
        ...(dto.description !== undefined ? { description: clean(dto.description) } : {}),
        ...(dto.contactEmail !== undefined ? { contactEmail: clean(dto.contactEmail) } : {}),
      },
    });
    return this.toProfile(upd);
  }

  /** Approuve ou refuse la demande d'adhésion d'un joueur — réservé à l'association propriétaire du club demandé. */
  async reviewMember(ownerId: string, userId: string, approve: boolean) {
    const club = await this.clubOf(ownerId);
    if (club.status !== 'APPROVED') throw new ForbiddenException("Ton association doit d'abord être validée par l'équipe Miabe.");
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || u.clubStatus !== 'PENDING' || u.clubRequestedId !== club.id) throw new NotFoundException("Aucune demande d'adhésion en attente pour ce joueur.");
    if (approve) {
      const player = await this.prisma.player.findFirst({ where: { userId } });
      if (player) await this.prisma.player.update({ where: { id: player.id }, data: { clubId: club.id } });
      else await this.prisma.player.create({ data: { name: u.displayName, city: u.city, userId, clubId: club.id } });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { clubStatus: approve ? 'APPROVED' : 'REJECTED', clubRequested: null, clubRequestedId: null, clubBlocking: false, clubReviewedAt: new Date() },
    });
    await this.mail.send(
      u.email,
      approve ? `${club.name} t'a accepté — Miabe Esport` : `Adhésion à ${club.name} non retenue — Miabe Esport`,
      this.mail.layout(
        approve ? 'Adhésion validée' : 'Adhésion non retenue',
        approve
          ? `<p>Bonjour ${escapeHtml(u.displayName)},</p><p>L'association <b>${escapeHtml(club.name)}</b> a validé ton adhésion : le club apparaît maintenant sur ta fiche joueur.</p>`
          : `<p>Bonjour ${escapeHtml(u.displayName)},</p><p>L'association <b>${escapeHtml(club.name)}</b> n'a pas retenu ta demande d'adhésion pour le moment. Ton compte reste actif, sans club.</p>`,
      ),
    ).catch(() => { /* best-effort */ });
    return { id: userId, status: approve ? 'APPROVED' : 'REJECTED' };
  }

  /** Retire un membre du club (il redevient « sans club »). */
  async removeMember(ownerId: string, playerId: string) {
    const club = await this.clubOf(ownerId);
    const p = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!p || p.clubId !== club.id) throw new NotFoundException("Ce joueur n'est pas membre de ton club.");
    await this.prisma.player.update({ where: { id: playerId }, data: { clubId: null } });
    if (p.userId) await this.prisma.user.update({ where: { id: p.userId }, data: { clubStatus: 'NONE', clubRequested: null, clubRequestedId: null } });
    return { id: playerId };
  }

  /** Prévient l'association qu'un joueur demande à rejoindre son club (e-mail au responsable). Best-effort : ne bloque jamais l'inscription. */
  async notifyJoinRequest(clubId: string, playerName: string): Promise<void> {
    try {
      const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { name: true, contactEmail: true, owner: { select: { email: true } } } });
      const to = club?.owner?.email || club?.contactEmail;
      if (!club || !to) return;
      await this.mail.send(
        to,
        `Nouvelle demande d'adhésion à ${club.name} — Miabe Esport`,
        this.mail.layout(
          "Une demande d'adhésion t'attend",
          `<p><b>${escapeHtml(playerName)}</b> demande à rejoindre <b>${escapeHtml(club.name)}</b>.</p><p>Accepte ou refuse sa demande depuis ton espace <b>Mon club</b> : le club apparaît sur sa fiche joueur dès que tu l'acceptes.</p>`,
          { label: 'Ouvrir Mon club', url: `${this.mail.siteUrl}/#profil/club` },
        ),
      );
    } catch { /* best-effort */ }
  }

  /* ---------- Côté admin de la plateforme : intégration des associations ---------- */

  /** Clubs déjà dans la base mais sans compte association : l'admin peut leur en rattacher un. */
  listUnowned() {
    return this.prisma.club.findMany({ where: { status: 'APPROVED', ownerId: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, city: true, _count: { select: { players: true } } } });
  }

  /** Rattache un compte association à un club existant. Crée le compte (mot de passe temporaire, renvoyé une seule fois et envoyé par e-mail)
   *  ou reprend un compte association déjà existant et sans club. Jamais un compte joueur/organisateur/admin : ce serait lui retirer ses droits. */
  async attachOwner(clubId: string, rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new NotFoundException('Club introuvable.');
    if (club.ownerId) throw new ConflictException('Ce club a déjà un compte association.');
    const existing = await this.prisma.user.findUnique({ where: { email }, include: { ownedClub: true } });
    if (existing && (existing.role !== 'ASSOCIATION' || existing.ownedClub)) {
      throw new ConflictException('Cette adresse est déjà utilisée par un autre compte. Utilise une autre adresse pour l\'association.');
    }
    let password: string | null = null;
    let userId = existing?.id;
    if (!existing) {
      password = randomBytes(9).toString('base64url');
      const u = await this.prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), displayName: club.name, role: 'ASSOCIATION', city: club.city, phone: null } });
      userId = u.id;
    }
    await this.prisma.club.update({ where: { id: clubId }, data: { ownerId: userId, contactEmail: club.contactEmail ?? email } });
    let emailed = false;
    if (password) {
      emailed = await this.mail.send(
        email,
        `Ton espace association ${club.name} — Miabe Esport`,
        this.mail.layout(
          'Ton espace association est prêt',
          `<p>Bonjour,</p><p>Un compte association a été créé pour <b>${escapeHtml(club.name)}</b> sur Miabe Esport. Tu y valides l'adhésion de tes joueurs, gères le profil du club et récupères les codes pour afficher tes tournois sur ton site.</p><p>Identifiant : <b>${escapeHtml(email)}</b><br/>Mot de passe temporaire : <b>${escapeHtml(password)}</b></p><p>Change ce mot de passe dès ta première connexion (Mon compte).</p>`,
          { label: 'Me connecter', url: `${this.mail.siteUrl}/#connexion` },
        ),
      ).then(() => true).catch(() => false);
    }
    return { clubId, email, created: !!password, password, emailed };
  }

  listPending() {
    return this.prisma.club.findMany({
      where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, city: true, website: true, description: true, contactEmail: true, createdAt: true, owner: { select: { id: true, displayName: true, email: true, phone: true } } },
    });
  }

  async review(clubId: string, approve: boolean) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, include: { owner: true } });
    if (!club || club.status !== 'PENDING') throw new NotFoundException('Aucune association en attente avec cet identifiant.');
    await this.prisma.club.update({ where: { id: clubId }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
    if (club.owner) {
      await this.mail.send(
        club.owner.email,
        approve ? `${club.name} est intégrée à Miabe Esport` : "Ton association n'a pas été retenue — Miabe Esport",
        this.mail.layout(
          approve ? 'Association validée' : 'Association non retenue',
          approve
            ? `<p>Bonjour ${escapeHtml(club.owner.displayName)},</p><p>L'association <b>${escapeHtml(club.name)}</b> est maintenant intégrée : elle apparaît dans la liste des clubs, tes joueurs peuvent la choisir à l'inscription, et tu valides leur adhésion depuis ton espace <b>Mon club</b>. Tu y trouveras aussi les codes pour afficher tes tournois sur ton site.</p>`
            : `<p>Bonjour ${escapeHtml(club.owner.displayName)},</p><p>L'association <b>${escapeHtml(club.name)}</b> n'a pas été retenue pour le moment. Contacte l'équipe Miabe pour en savoir plus.</p>`,
        ),
      ).catch(() => { /* best-effort */ });
    }
    return { id: clubId, status: approve ? 'APPROVED' : 'REJECTED' };
  }

  /* ---------- Données publiques pour la page / le widget embarqué ---------- */

  /** Tout ce qui est rattaché à une association : profil, membres, classement, tournois qu'elle organise et tournois où jouent ses membres. */
  async publicClub(slug: string) {
    const club = await this.prisma.club.findUnique({ where: { slug } });
    if (!club || club.status !== 'APPROVED') throw new NotFoundException('Association introuvable.');
    const players = await this.prisma.player.findMany({
      where: { clubId: club.id },
      select: { id: true, name: true, city: true, userId: true, user: { select: { role: true } } },
    });
    const ranked = await this.withStats(players);
    const memberUserIds = players.map((p) => p.userId).filter((x): x is string => !!x);
    const creatorIds = [club.ownerId, ...players.filter((p) => p.user?.role === 'ORGANIZER').map((p) => p.userId)].filter((x): x is string => !!x);
    // Jamais un tournoi rattaché à un événement non publié.
    const visible = { OR: [{ eventId: null }, { event: { is: { status: 'PUBLISHED' } } }] };
    const [organized, played] = await Promise.all([
      this.prisma.tournament.findMany({ where: { createdById: { in: creatorIds }, AND: [visible] }, orderBy: { createdAt: 'desc' }, take: MAX_PUBLIC_TOURNAMENTS, select: TOURNAMENT_SELECT }),
      this.prisma.tournament.findMany({ where: { registrations: { some: { userId: { in: memberUserIds } } }, AND: [visible] }, orderBy: { createdAt: 'desc' }, take: MAX_PUBLIC_TOURNAMENTS, select: TOURNAMENT_SELECT }),
    ]);
    const organizedIds = new Set(organized.map((t) => t.id));
    const toCard = (t: (typeof organized)[number], organizedByClub: boolean) => ({
      id: t.id, name: t.name, game: t.game, status: t.status, date: t.date, place: t.place, imageUrl: t.imageUrl, organizedByClub,
    });
    return {
      club: { name: club.name, slug: club.slug, city: club.city, logoUrl: club.logoUrl, website: club.website, description: club.description },
      stats: { members: players.length, organized: organized.length },
      members: ranked.map((p, i) => ({ rank: i + 1, name: p.name, city: p.city, points: p.points, wins: p.wins, matches: p.matches })),
      tournaments: [...organized.map((t) => toCard(t, true)), ...played.filter((t) => !organizedIds.has(t.id)).map((t) => toCard(t, false))],
    };
  }
}
