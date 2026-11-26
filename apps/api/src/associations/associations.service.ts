import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, escapeHtml } from '../mail/mail.service';
import { UpdateAssociationDto } from './associations.dto';
import { TournamentsService } from '../tournaments/tournaments.service';
import { MembershipService, WAITING_STATUSES } from './membership.service';

const MAX_PUBLIC_TOURNAMENTS = 40;
const TOURNAMENT_SELECT = { id: true, name: true, game: true, status: true, date: true, place: true, imageUrl: true } as const;

@Injectable()
export class AssociationsService {
  constructor(private prisma: PrismaService, private mail: MailService, private tournaments: TournamentsService, private membership: MembershipService) {}

  /** Points / victoires / matchs RÉELS de chaque membre (tous jeux confondus), calculés sur les tournois et attribués au bon compte. */
  private async withStats<T extends { id: string; name: string; userId: string | null }>(players: T[]) {
    const totals = await this.tournaments.playerStats(players);
    return players
      .map((p) => ({ p, t: totals.get(p.id) ?? { points: 0, wins: 0, matches: 0 } }))
      .sort((x, y) => y.t.points - x.t.points || y.t.wins - x.t.wins || x.p.name.localeCompare(y.p.name))
      .map(({ p, t }) => ({ ...p, points: t.points, wins: t.wins, matches: t.matches }));
  }

  /** Demandes, invitations, membres classés et anciens membres d'un club (espace du responsable et fiche côté admin). */
  private async roster(clubId: string) {
    const rows = await this.prisma.clubMembership.findMany({
      where: { clubId, status: { in: ['active', 'requested', 'invited', 'left', 'removed'] } },
      orderBy: { createdAt: 'desc' },
      include: { player: { select: { id: true, name: true, city: true, userId: true, user: { select: { email: true, avatarUrl: true } } } } },
    });
    const of = (status: string) => rows.filter((m) => m.status === status);
    const ranked = await this.withStats(of('active').map((m) => ({ id: m.player.id, name: m.player.name, city: m.player.city, userId: m.player.userId, avatarUrl: m.player.user?.avatarUrl ?? null, since: m.decidedAt })));
    return {
      // L'adresse n'est montrée que pour les demandes : le joueur l'a lui-même adressée à ce club.
      requests: of('requested').reverse().map((m) => ({ id: m.id, playerId: m.player.id, name: m.player.name, city: m.player.city, email: m.player.user?.email ?? null, createdAt: m.createdAt })),
      invites: of('invited').map((m) => ({ id: m.id, playerId: m.player.id, name: m.player.name, city: m.player.city, createdAt: m.createdAt })),
      members: ranked.map((p) => ({ id: p.id, avatarUrl: p.avatarUrl, name: p.name, city: p.city, since: p.since, points: p.points, wins: p.wins, matches: p.matches, hasAccount: !!p.userId })),
      history: rows.filter((m) => m.status === 'left' || m.status === 'removed')
        .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0)).slice(0, 20)
        .map((m) => ({ id: m.id, name: m.player.name, status: m.status, since: m.decidedAt, endedAt: m.endedAt })),
    };
  }

  /** Clubs validés (lecture publique). `joined` : le club a un gestionnaire, on peut donc demander à le rejoindre. */
  async publicClubs() {
    const rows = await this.prisma.club.findMany({ where: { status: 'APPROVED' }, orderBy: { name: 'asc' }, select: { id: true, name: true, city: true, logoUrl: true, slug: true, ownerId: true } });
    return rows.map(({ ownerId, ...c }) => ({ ...c, joined: !!ownerId }));
  }

  private async clubOf(ownerId: string) {
    const club = await this.prisma.club.findUnique({ where: { ownerId } });
    if (!club) throw new NotFoundException("Aucune association n'est rattachée à ce compte.");
    return club;
  }

  private toProfile(c: { id: string; name: string; slug: string | null; city: string | null; logoUrl: string | null; website: string | null; description: string | null; contactEmail: string | null; status: string }) {
    return { id: c.id, name: c.name, slug: c.slug, city: c.city, logoUrl: c.logoUrl, website: c.website, description: c.description, contactEmail: c.contactEmail, status: c.status };
  }

  /** Espace « Mon club » : profil, demandes, invitations, membres, anciens membres. */
  async me(ownerId: string) {
    const club = await this.clubOf(ownerId);
    return { club: this.toProfile(club), ...(await this.roster(club.id)) };
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

  async reviewMember(ownerId: string, membershipId: string, approve: boolean) {
    return this.membership.reviewRequest((await this.clubOf(ownerId)).id, membershipId, approve);
  }

  async invite(ownerId: string, target: { playerId?: string; email?: string }) {
    return this.membership.invite((await this.clubOf(ownerId)).id, target);
  }

  async cancelInvite(ownerId: string, membershipId: string) {
    return this.membership.cancelInvite((await this.clubOf(ownerId)).id, membershipId);
  }

  async removeMember(ownerId: string, playerId: string) {
    return this.membership.removeMember((await this.clubOf(ownerId)).id, playerId);
  }

  async candidates(ownerId: string, query: string) {
    const club = await this.clubOf(ownerId);
    return club.status === 'APPROVED' ? this.membership.candidates(club.id, query) : [];
  }

  /* ---------- Côté admin de la plateforme : intégration des associations ---------- */

  /** Tous les clubs, avec leur statut, leur responsable et leurs effectifs, plus les reprises de fiches à valider. */
  async overview() {
    await this.membership.notifyWaitingPlayers().catch(() => { /* best-effort */ });
    const [clubs, counts, claims, waiting] = await Promise.all([
      this.prisma.club.findMany({ orderBy: { name: 'asc' }, include: { owner: { select: { id: true, displayName: true, email: true, role: true, phone: true } } } }),
      this.prisma.clubMembership.groupBy({ by: ['clubId', 'status'], where: { status: { in: ['active', 'requested'] } }, _count: { _all: true } }),
      this.prisma.player.findMany({ where: { claimUserId: { not: null } }, select: { id: true, name: true, city: true, claimUserId: true, club: { select: { name: true } } } }),
      this.prisma.user.findMany({ where: { clubStatus: { in: WAITING_STATUSES }, clubRequested: { not: null } }, orderBy: { createdAt: 'asc' }, select: { id: true, displayName: true, email: true, clubStatus: true, clubRequested: true } }),
    ]);
    const claimers = claims.length
      ? await this.prisma.user.findMany({ where: { id: { in: claims.map((c) => c.claimUserId!) } }, select: { id: true, displayName: true, email: true, createdAt: true } })
      : [];
    const count = (clubId: string, status: string) => counts.find((c) => c.clubId === clubId && c.status === status)?._count._all ?? 0;
    return {
      clubs: clubs.map((c) => ({ ...this.toProfile(c), createdAt: c.createdAt, owner: c.owner, members: count(c.id, 'active'), requests: count(c.id, 'requested') })),
      claims: claims.map((c) => ({ playerId: c.id, name: c.name, city: c.city, clubName: c.club?.name ?? null, user: claimers.find((u) => u.id === c.claimUserId) ?? null })),
      // Joueurs dont le club n'a pas encore rejoint la plateforme (information seule : rien à valider).
      waiting: waiting.map((u) => ({ id: u.id, name: u.displayName, email: u.email, clubName: u.clubRequested, status: u.clubStatus })),
    };
  }

  async detail(clubId: string) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new NotFoundException('Club introuvable.');
    return { club: this.toProfile(club), ...(await this.roster(clubId)) };
  }

  adminRemoveMember(clubId: string, playerId: string) {
    return this.membership.removeMember(clubId, playerId);
  }

  async adminAddMember(clubId: string, playerId: string) {
    await this.membership.adminSetClub(playerId, clubId);
    return { clubId, playerId };
  }

  /** Retire le responsable d'un club (son compte reste, avec son rôle) : le club peut alors en recevoir un autre. */
  async detachOwner(clubId: string) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new NotFoundException('Club introuvable.');
    if (!club.ownerId) throw new BadRequestException("Ce club n'a pas de responsable.");
    await this.prisma.club.update({ where: { id: clubId }, data: { ownerId: null } });
    return { clubId };
  }

  /** Fusionne un doublon dans un autre club : membres, historique et responsable suivent, puis le doublon est supprimé. */
  async merge(sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException('Choisis deux clubs différents.');
    const [source, target] = await Promise.all([
      this.prisma.club.findUnique({ where: { id: sourceId } }),
      this.prisma.club.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || !target) throw new NotFoundException('Club introuvable.');
    if (source.ownerId && target.ownerId) throw new ConflictException("Les deux clubs ont un responsable : retire d'abord l'un des deux.");
    await this.prisma.$transaction(async (tx) => {
      // Une demande ou invitation déjà ouverte dans le club d'arrivée rend celle du doublon inutile.
      const open = await tx.clubMembership.findMany({ where: { clubId: targetId, status: { in: ['active', 'requested', 'invited'] } }, select: { playerId: true } });
      await tx.clubMembership.updateMany({
        where: { clubId: sourceId, status: { in: ['requested', 'invited'] }, playerId: { in: open.map((m) => m.playerId) } },
        data: { status: 'cancelled', endedAt: new Date() },
      });
      await tx.clubMembership.updateMany({ where: { clubId: sourceId }, data: { clubId: targetId } });
      await tx.player.updateMany({ where: { clubId: sourceId }, data: { clubId: targetId } });
      if (source.ownerId) await tx.club.update({ where: { id: sourceId }, data: { ownerId: null } });
      await tx.club.update({
        where: { id: targetId },
        data: {
          ownerId: target.ownerId ?? source.ownerId, city: target.city ?? source.city, logoUrl: target.logoUrl ?? source.logoUrl,
          website: target.website ?? source.website, description: target.description ?? source.description, contactEmail: target.contactEmail ?? source.contactEmail,
        },
      });
      await tx.club.delete({ where: { id: sourceId } });
    });
    return { id: targetId };
  }

  /** Suppression d'un club : impossible tant qu'il a un responsable ; ses joueurs restent dans la base, sans club. */
  async removeClub(clubId: string) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new NotFoundException('Club introuvable.');
    if (club.ownerId) throw new ConflictException("Ce club a un responsable : retire-le d'abord (Clubs & associations).");
    await this.prisma.$transaction([
      this.prisma.player.updateMany({ where: { clubId }, data: { clubId: null } }),
      this.prisma.user.updateMany({ where: { clubRequestedId: clubId }, data: { clubStatus: 'NONE', clubRequested: null, clubRequestedId: null, clubBlocking: false } }),
      this.prisma.club.delete({ where: { id: clubId } }),
    ]);
    return { deleted: true };
  }

  /** Rattache un responsable à un club existant. Crée un compte association (mot de passe temporaire, renvoyé une seule fois et envoyé par
   *  e-mail) ou reprend un compte existant sans club : association, organisateur ou admin. Le rôle d'un compte repris n'est JAMAIS modifié
   *  (il garde ses droits et gagne l'espace « Mon club »). Un compte joueur est refusé : il n'a pas d'espace de gestion. */
  async attachOwner(clubId: string, rawEmail: string, replace = false) {
    const email = rawEmail.trim().toLowerCase();
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new NotFoundException('Club introuvable.');
    if (club.ownerId && !replace) throw new ConflictException('Ce club a déjà un compte association.');
    const existing = await this.prisma.user.findUnique({ where: { email }, include: { ownedClub: true } });
    if (existing?.ownedClub) throw new ConflictException(`Ce compte gère déjà le club « ${existing.ownedClub.name} » : un compte ne gère qu'un seul club.`);
    if (existing && existing.role === 'PLAYER') {
      throw new ConflictException('Cette adresse est déjà utilisée par un compte joueur. Passe-le organisateur, ou utilise une autre adresse pour l\'association.');
    }
    let password: string | null = null;
    let userId = existing?.id;
    if (!existing) {
      password = randomBytes(9).toString('base64url');
      const u = await this.prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), displayName: club.name, role: 'ASSOCIATION', city: club.city, phone: null } });
      userId = u.id;
    }
    await this.prisma.club.update({ where: { id: clubId }, data: { ownerId: userId, contactEmail: club.contactEmail ?? email } });
    await this.membership.notifyWaitingPlayers().catch(() => { /* best-effort */ });
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

  async review(clubId: string, approve: boolean) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, include: { owner: true } });
    // En attente : on valide ou on refuse. Refusée : on peut encore la valider (réactivation).
    if (!club || !(club.status === 'PENDING' || (club.status === 'REJECTED' && approve))) throw new NotFoundException('Aucune association à traiter avec cet identifiant.');
    await this.prisma.club.update({ where: { id: clubId }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
    if (approve) await this.membership.notifyWaitingPlayers().catch(() => { /* best-effort */ });
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
    const club = await this.prisma.club.findUnique({ where: { slug }, include: { owner: { select: { role: true } } } });
    if (!club || club.status !== 'APPROVED') throw new NotFoundException('Association introuvable.');
    const players = await this.prisma.player.findMany({
      where: { clubId: club.id },
      select: { id: true, name: true, city: true, userId: true, user: { select: { role: true, avatarUrl: true } } },
    });
    const ranked = await this.withStats(players);
    const memberUserIds = players.map((p) => p.userId).filter((x): x is string => !!x);
    // Un admin responsable d'un club crée aussi les tournois de la plateforme : ils ne sont pas attribués au club.
    const creatorIds = [club.owner?.role === 'ADMIN' ? null : club.ownerId, ...players.filter((p) => p.user?.role === 'ORGANIZER').map((p) => p.userId)].filter((x): x is string => !!x);
    // Jamais un brouillon, ni un tournoi rattaché à un événement non publié.
    const visible = { OR: [{ eventId: null, publication: { not: 'DRAFT' } }, { event: { is: { status: 'PUBLISHED' } } }] };
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
      members: ranked.map((p, i) => ({ rank: i + 1, avatarUrl: p.user?.avatarUrl ?? null, name: p.name, city: p.city, points: p.points, wins: p.wins, matches: p.matches })),
      tournaments: [...organized.map((t) => toCard(t, true)), ...played.filter((t) => !organizedIds.has(t.id)).map((t) => toCard(t, false))],
    };
  }
}
