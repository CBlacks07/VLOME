import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, escapeHtml } from '../mail/mail.service';
import { UpdateAssociationDto } from './associations.dto';

const MAX_PUBLIC_TOURNAMENTS = 40;
const TOURNAMENT_SELECT = { id: true, name: true, game: true, status: true, date: true, place: true, imageUrl: true } as const;

@Injectable()
export class AssociationsService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

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
      this.prisma.player.findMany({ where: { clubId: club.id }, orderBy: [{ points: 'desc' }, { name: 'asc' }], select: { id: true, name: true, city: true, elo: true, points: true, userId: true } }),
    ]);
    return { club: this.toProfile(club), pending, members: members.map((m) => ({ id: m.id, name: m.name, city: m.city, elo: m.elo, points: m.points, hasAccount: !!m.userId })) };
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

  /* ---------- Côté admin de la plateforme : intégration des associations ---------- */

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
      where: { clubId: club.id }, orderBy: [{ points: 'desc' }, { elo: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, city: true, elo: true, points: true, userId: true, user: { select: { role: true } } },
    });
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
      members: players.map((p, i) => ({ rank: i + 1, name: p.name, city: p.city, elo: p.elo, points: p.points })),
      tournaments: [...organized.map((t) => toCard(t, true)), ...played.filter((t) => !organizedIds.has(t.id)).map((t) => toCard(t, false))],
    };
  }
}
