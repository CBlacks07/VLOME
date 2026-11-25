import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService, escapeHtml } from '../mail/mail.service';
import { slugify } from '../common/slug';

/** Invitations en attente qu'un club peut avoir en même temps (évite qu'un compte association serve à arroser les joueurs). */
export const MAX_OPEN_INVITES = 50;

const CLUB_SELECT = { id: true, name: true, slug: true, city: true, logoUrl: true, status: true } as const;

/** Joueur qui attend un club pas encore sur la plateforme : à prévenir, prévenu d'attendre, prévenu que le club est arrivé. */
export const WAITING_STATUSES = ['WAITING', 'INFORMED', 'AVAILABLE'];

/**
 * Adhésions joueur ↔ club. C'est le SEUL endroit qui écrit Player.clubId : toute entrée ou sortie d'un club passe ici,
 * laisse une trace datée et prévient les intéressés (e-mails « au mieux » : un envoi raté ne bloque jamais l'action).
 */
@Injectable()
export class MembershipService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  /* ---------- Fiches joueurs ---------- */

  /** Fiche de la base de joueurs liée à ce compte, créée au besoin. */
  async ensurePlayer(userId: string) {
    const existing = await this.prisma.player.findUnique({ where: { userId } });
    if (existing) return existing;
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('Compte introuvable.');
    return this.prisma.player.create({ data: { name: u.displayName, city: u.city, userId } });
  }

  /** Nouveau compte joueur : sa propre fiche est créée. Si une fiche SANS compte porte le même nom, elle n'est pas
   *  reprise d'office (n'importe qui pourrait s'approprier le club et l'historique d'un homonyme) : la reprise est
   *  demandée, et l'équipe la valide. */
  async linkNewAccount(userId: string, name: string, city: string | null) {
    const twin = await this.prisma.player.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, userId: null, claimUserId: null } });
    await this.prisma.player.create({ data: { name, city, userId } });
    if (!twin) return;
    await this.prisma.player.update({ where: { id: twin.id }, data: { claimUserId: userId } });
    await this.mail.notifyTeam(
      `Fiche joueur à vérifier : ${name}`,
      'Reprise de fiche à valider',
      `<p>Le nouveau compte <b>${escapeHtml(name)}</b> porte le même nom qu'une fiche déjà présente dans la base de joueurs. Vérifie que c'est bien la même personne avant de la lui attribuer.</p>`,
      { label: 'Ouvrir Clubs & associations', url: `${this.mail.siteUrl}/#profil/clubs` },
    ).catch(() => { /* best-effort */ });
  }

  /** Décision de l'équipe sur une reprise de fiche : la fiche (club, historique) revient au compte, ou la demande est écartée. */
  async reviewClaim(playerId: string, approve: boolean) {
    const fiche = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!fiche?.claimUserId) throw new NotFoundException('Aucune demande de reprise sur cette fiche.');
    const userId = fiche.claimUserId;
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!approve || !u) {
      await this.prisma.player.update({ where: { id: playerId }, data: { claimUserId: null } });
      if (u) await this.notify(u.email, 'Fiche joueur non attribuée', `<p>Bonjour ${escapeHtml(u.displayName)},</p><p>L'équipe Miabe n'a pas rattaché l'ancienne fiche « ${escapeHtml(fiche.name)} » à ton compte. Ton compte et ta fiche actuelle restent inchangés.</p>`);
      return { id: playerId, approved: false };
    }
    if (fiche.userId) throw new ConflictException('Cette fiche est déjà liée à un compte.');
    await this.prisma.$transaction(async (tx) => {
      const own = await tx.player.findUnique({ where: { userId } });
      if (own) {
        // La fiche provisoire du compte disparaît ; ses adhésions suivent (un seul club actif : celui de la fiche reprise l'emporte).
        const keep = await tx.clubMembership.findFirst({ where: { playerId, status: 'active' } });
        if (keep) await tx.clubMembership.updateMany({ where: { playerId: own.id, status: 'active' }, data: { status: 'left', endedAt: new Date() } });
        await tx.clubMembership.updateMany({ where: { playerId: own.id }, data: { playerId } });
        await tx.player.delete({ where: { id: own.id } });
      }
      const active = await tx.clubMembership.findFirst({ where: { playerId, status: 'active' } });
      await tx.player.update({ where: { id: playerId }, data: { userId, claimUserId: null, name: u.displayName, city: fiche.city ?? u.city, clubId: active?.clubId ?? null } });
    });
    await this.notify(u.email, 'Ta fiche joueur est rattachée', `<p>Bonjour ${escapeHtml(u.displayName)},</p><p>La fiche « ${escapeHtml(fiche.name)} » de la base de joueurs est maintenant liée à ton compte.</p>`);
    return { id: playerId, approved: true };
  }

  /* ---------- Côté joueur ---------- */

  /** Tout ce que le joueur doit voir : son club, sa demande en cours, ses invitations, son parcours. */
  async overview(userId: string) {
    const [player, claim, user] = await Promise.all([
      this.prisma.player.findUnique({ where: { userId }, include: { memberships: { orderBy: { createdAt: 'desc' }, include: { club: { select: CLUB_SELECT } } } } }),
      this.prisma.player.findFirst({ where: { claimUserId: userId }, select: { id: true, name: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { clubStatus: true, clubRequested: true } }),
    ]);
    const awaited = user && WAITING_STATUSES.includes(user.clubStatus) ? user.clubRequested : null;
    const arrived = awaited ? (await this.joinedClubs()).find((c) => slugify(c.name) === slugify(awaited)) : undefined;
    const all = player?.memberships ?? [];
    const view = (m: (typeof all)[number]) => ({ id: m.id, club: m.club, status: m.status, createdAt: m.createdAt, since: m.decidedAt, endedAt: m.endedAt });
    const current = all.find((m) => m.status === 'active');
    const request = all.find((m) => m.status === 'requested');
    // Dernière demande du joueur, si elle a été refusée et que rien ne l'a remplacée depuis (liste triée du plus récent au plus ancien).
    const lastAsked = all.find((m) => m.initiatedBy === 'player');
    const refused = !current && !request && lastAsked?.status === 'rejected' ? lastAsked : undefined;
    return {
      current: current ? view(current) : null,
      request: request ? view(request) : null,
      refused: refused ? view(refused) : null,
      invites: all.filter((m) => m.status === 'invited').map(view),
      history: all.filter((m) => m.status === 'left' || m.status === 'removed').slice(0, 10).map(view),
      claim,
      // Club que le joueur attend : `clubId` est renseigné dès que ce club a rejoint la plateforme.
      awaitedClub: awaited ? { name: awaited, clubId: arrived?.id ?? null } : null,
    };
  }

  /** Demande à rejoindre un club validé. Une seule demande à la fois : la nouvelle remplace la précédente. */
  async request(userId: string, clubId: string) {
    // Un compte association gère son club : il n'est pas un joueur qui adhère.
    const account = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (account?.role === 'ASSOCIATION') throw new ForbiddenException("Un compte association ne rejoint pas de club : utilise un compte joueur.");
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club || club.status !== 'APPROVED') throw new BadRequestException('Club introuvable : choisis un club de la liste.');
    if (!club.ownerId) throw new BadRequestException("Ce club n'a pas encore rejoint la plateforme : tu pourras faire ta demande quand il aura un gestionnaire.");
    // La demande est faite : le joueur n'« attend » plus de club.
    await this.prisma.user.updateMany({ where: { id: userId, clubStatus: { in: WAITING_STATUSES } }, data: { clubStatus: 'NONE', clubRequested: null } });
    const player = await this.ensurePlayer(userId);
    const mine = await this.prisma.clubMembership.findMany({ where: { playerId: player.id, status: { in: ['active', 'requested', 'invited'] } } });
    if (mine.some((m) => m.status === 'active' && m.clubId === clubId)) throw new ConflictException('Tu es déjà membre de ce club.');
    // Le club l'avait déjà invité : demander à le rejoindre revient à accepter l'invitation.
    const invite = mine.find((m) => m.status === 'invited' && m.clubId === clubId);
    if (invite) {
      await this.activate(invite.id);
      await this.notifyClub(clubId, `${player.name} a rejoint ton club`, 'Invitation acceptée', `<p><b>${escapeHtml(player.name)}</b> est maintenant membre de <b>${escapeHtml(club.name)}</b>.</p>`);
      return { status: 'joined' as const };
    }
    if (mine.some((m) => m.status === 'requested' && m.clubId === clubId)) return { status: 'requested' as const };
    await this.prisma.clubMembership.updateMany({ where: { playerId: player.id, status: 'requested' }, data: { status: 'cancelled', endedAt: new Date() } });
    await this.prisma.clubMembership.create({ data: { clubId, playerId: player.id, status: 'requested', initiatedBy: 'player' } });
    await this.notifyClub(clubId, `Nouvelle demande d'adhésion à ${club.name}`, "Une demande d'adhésion t'attend",
      `<p><b>${escapeHtml(player.name)}</b> demande à rejoindre <b>${escapeHtml(club.name)}</b>.</p><p>Accepte ou refuse sa demande depuis ton espace <b>Mon club</b>.</p>`);
    return { status: 'requested' as const };
  }

  async cancelRequest(userId: string) {
    const player = await this.prisma.player.findUnique({ where: { userId } });
    const done = player ? await this.prisma.clubMembership.updateMany({ where: { playerId: player.id, status: 'requested' }, data: { status: 'cancelled', endedAt: new Date() } }) : { count: 0 };
    if (!done.count) throw new NotFoundException('Aucune demande en attente.');
    return { status: 'cancelled' as const };
  }

  async leave(userId: string) {
    const player = await this.prisma.player.findUnique({ where: { userId } });
    const active = player ? await this.prisma.clubMembership.findFirst({ where: { playerId: player.id, status: 'active' } }) : null;
    if (!player || !active) throw new NotFoundException("Tu n'es membre d'aucun club.");
    await this.end(active.id, player.id, 'left');
    await this.notifyClub(active.clubId, `${player.name} a quitté ton club`, 'Départ d\'un membre', `<p><b>${escapeHtml(player.name)}</b> a quitté le club.</p>`);
    return { status: 'left' as const };
  }

  async answerInvite(userId: string, membershipId: string, accept: boolean) {
    const m = await this.prisma.clubMembership.findUnique({ where: { id: membershipId }, include: { player: true, club: true } });
    if (!m || m.player.userId !== userId || m.status !== 'invited') throw new NotFoundException('Invitation introuvable ou déjà traitée.');
    if (accept) {
      if (m.club.status !== 'APPROVED') throw new ForbiddenException("Ce club n'est pas actif pour le moment.");
      await this.activate(m.id);
    } else {
      await this.prisma.clubMembership.update({ where: { id: m.id }, data: { status: 'rejected', endedAt: new Date() } });
    }
    await this.notifyClub(m.clubId, accept ? `${m.player.name} a rejoint ton club` : `${m.player.name} a décliné ton invitation`, accept ? 'Invitation acceptée' : 'Invitation déclinée',
      `<p><b>${escapeHtml(m.player.name)}</b> ${accept ? `est maintenant membre de <b>${escapeHtml(m.club.name)}</b>` : 'a décliné ton invitation'}.</p>`);
    return { status: accept ? ('active' as const) : ('rejected' as const) };
  }

  /* ---------- Côté club (responsable ou équipe Miabe) ---------- */

  /** Invite un joueur qui a un compte, désigné par sa fiche (recherche par nom) ou par l'adresse e-mail de son compte.
   *  Par e-mail, la réponse est la même que le compte existe ou non (on ne révèle pas qui est inscrit). */
  async invite(clubId: string, target: { playerId?: string; email?: string }) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club || club.status !== 'APPROVED') throw new ForbiddenException("Ton association doit d'abord être validée par l'équipe Miabe.");
    const byEmail = !target.playerId;
    let playerId = target.playerId;
    if (byEmail) {
      const email = (target.email || '').trim().toLowerCase();
      if (!email) throw new BadRequestException('Choisis un joueur ou saisis son adresse e-mail.');
      const u = await this.prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
      if (!u || u.role === 'ASSOCIATION') return { status: 'sent' as const };
      playerId = (await this.ensurePlayer(u.id)).id;
    }
    const player = await this.prisma.player.findUnique({ where: { id: playerId }, include: { user: { select: { email: true } } } });
    if (!player) throw new NotFoundException('Joueur introuvable.');
    if (!player.user) throw new BadRequestException("Ce joueur n'a pas de compte : il ne peut pas répondre à une invitation. Demande-lui de s'inscrire.");
    const mine = await this.prisma.clubMembership.findMany({ where: { playerId: player.id, clubId, status: { in: ['active', 'requested', 'invited'] } } });
    if (mine.some((m) => m.status === 'active')) throw new ConflictException('Ce joueur est déjà membre de ton club.');
    const asked = mine.find((m) => m.status === 'requested');
    if (asked) {
      await this.activate(asked.id);
      await this.notify(player.user.email, `${club.name} t'a accepté`, `<p>Bonjour ${escapeHtml(player.name)},</p><p>Tu es maintenant membre de <b>${escapeHtml(club.name)}</b>.</p>`);
      return { status: 'joined' as const };
    }
    if (mine.some((m) => m.status === 'invited')) return { status: 'sent' as const };
    if ((await this.prisma.clubMembership.count({ where: { clubId, status: 'invited' } })) >= MAX_OPEN_INVITES) {
      throw new ConflictException(`Tu as déjà ${MAX_OPEN_INVITES} invitations en attente : annules-en avant d'en envoyer d'autres.`);
    }
    await this.prisma.clubMembership.create({ data: { clubId, playerId: player.id, status: 'invited', initiatedBy: 'club' } });
    await this.notify(player.user.email, `${club.name} t'invite à rejoindre le club`,
      `<p>Bonjour ${escapeHtml(player.name)},</p><p>L'association <b>${escapeHtml(club.name)}</b> t'invite à rejoindre son club. Accepte ou décline l'invitation depuis ton espace Miabe, rubrique <b>Mon club</b>.</p>`,
      { label: 'Répondre à l\'invitation', url: `${this.mail.siteUrl}/#profil/compte` });
    return { status: 'sent' as const };
  }

  async cancelInvite(clubId: string, membershipId: string) {
    const done = await this.prisma.clubMembership.updateMany({ where: { id: membershipId, clubId, status: 'invited' }, data: { status: 'cancelled', endedAt: new Date() } });
    if (!done.count) throw new NotFoundException('Invitation introuvable ou déjà traitée.');
    return { id: membershipId, status: 'cancelled' as const };
  }

  /** Accepte ou refuse la demande d'un joueur pour CE club. */
  async reviewRequest(clubId: string, membershipId: string, approve: boolean) {
    const m = await this.prisma.clubMembership.findUnique({ where: { id: membershipId }, include: { player: { include: { user: { select: { email: true } } } }, club: true } });
    if (!m || m.clubId !== clubId || m.status !== 'requested') throw new NotFoundException("Aucune demande d'adhésion en attente pour ce joueur.");
    if (m.club.status !== 'APPROVED') throw new ForbiddenException("Ton association doit d'abord être validée par l'équipe Miabe.");
    if (approve) await this.activate(m.id);
    else await this.prisma.clubMembership.update({ where: { id: m.id }, data: { status: 'rejected', decidedAt: new Date(), endedAt: new Date() } });
    if (m.player.user) {
      await this.notify(m.player.user.email, approve ? `${m.club.name} t'a accepté` : `Adhésion à ${m.club.name} non retenue`, approve
        ? `<p>Bonjour ${escapeHtml(m.player.name)},</p><p>L'association <b>${escapeHtml(m.club.name)}</b> a validé ton adhésion : le club apparaît maintenant sur ta fiche joueur.</p>`
        : `<p>Bonjour ${escapeHtml(m.player.name)},</p><p>L'association <b>${escapeHtml(m.club.name)}</b> n'a pas retenu ta demande d'adhésion pour le moment.</p>`);
    }
    return { id: m.id, status: approve ? ('active' as const) : ('rejected' as const) };
  }

  async removeMember(clubId: string, playerId: string) {
    const active = await this.prisma.clubMembership.findFirst({ where: { clubId, playerId, status: 'active' }, include: { player: { include: { user: { select: { email: true } } } }, club: true } });
    if (!active) throw new NotFoundException("Ce joueur n'est pas membre de ce club.");
    await this.end(active.id, playerId, 'removed');
    if (active.player.user) await this.notify(active.player.user.email, `Tu ne fais plus partie de ${active.club.name}`, `<p>Bonjour ${escapeHtml(active.player.name)},</p><p>Tu as été retiré du club <b>${escapeHtml(active.club.name)}</b>.</p>`);
    return { id: playerId };
  }

  /** Joueurs ayant un compte, retrouvés par leur nom, qu'un club peut inviter. Jamais d'adresse e-mail dans la réponse. */
  async candidates(clubId: string, query: string) {
    const q = (query || '').trim();
    if (q.length < 2) return [];
    const rows = await this.prisma.player.findMany({
      // « différent de ce club » doit inclure les joueurs SANS club (une comparaison SQL écarte les valeurs vides).
      where: { userId: { not: null }, name: { contains: q, mode: 'insensitive' }, OR: [{ clubId: null }, { clubId: { not: clubId } }] },
      orderBy: { name: 'asc' }, take: 15,
      select: { id: true, name: true, city: true, club: { select: { name: true } } },
    });
    return rows.map((p) => ({ id: p.id, name: p.name, city: p.city, clubName: p.club?.name ?? null }));
  }

  /** Affectation directe par l'équipe Miabe (base de joueurs, onglet Clubs) — avec la même trace qu'une adhésion. */
  async adminSetClub(playerId: string, clubId: string | null) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Joueur introuvable.');
    const active = await this.prisma.clubMembership.findFirst({ where: { playerId, status: 'active' } });
    if ((active?.clubId ?? null) === clubId) {
      if (player.clubId !== clubId) await this.prisma.player.update({ where: { id: playerId }, data: { clubId } });
      return;
    }
    if (!clubId) {
      if (active) await this.end(active.id, playerId, 'removed');
      else await this.prisma.player.update({ where: { id: playerId }, data: { clubId: null } });
      return;
    }
    const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { id: true, name: true, ownerId: true } });
    if (!club) throw new NotFoundException('Club introuvable.');
    // Club avec gestionnaire : c'est lui qui admet les joueurs. L'équipe ne peut ajouter que les fiches sans compte,
    // qu'il n'a aucun moyen d'inviter.
    if (club.ownerId && player.userId) throw new ForbiddenException(`« ${club.name} » a un gestionnaire : c'est lui qui valide les admissions (demande du joueur ou invitation).`);
    const m = await this.prisma.clubMembership.create({ data: { clubId, playerId, status: 'requested', initiatedBy: 'admin' } });
    await this.activate(m.id);
  }

  /* ---------- Joueurs qui attendent un club ---------- */

  /** Clubs présents sur la plateforme : validés ET dotés d'un gestionnaire capable d'admettre des joueurs. */
  private joinedClubs() {
    return this.prisma.club.findMany({ where: { status: 'APPROVED', ownerId: { not: null } }, select: { id: true, name: true } });
  }

  /** Prévient chaque joueur en attente, une seule fois par étape : « ton club n'est pas encore là », puis « il est
   *  arrivé, fais ta demande ». Si l'e-mail ne part pas, l'étape reste à faire et sera retentée. */
  async notifyWaitingPlayers(): Promise<void> {
    const waiting = await this.prisma.user.findMany({
      where: { clubStatus: { in: ['WAITING', 'INFORMED'] }, clubRequested: { not: null } },
      select: { id: true, email: true, displayName: true, clubStatus: true, clubRequested: true },
    });
    if (!waiting.length) return;
    const joined = await this.joinedClubs();
    for (const u of waiting) {
      const name = u.clubRequested!;
      const club = joined.find((c) => slugify(c.name) === slugify(name));
      if (!club && u.clubStatus === 'INFORMED') continue;
      const next = club ? 'AVAILABLE' : 'INFORMED';
      // Réservation avant envoi : deux appels simultanés n'écrivent pas deux fois au même joueur.
      const claimed = await this.prisma.user.updateMany({ where: { id: u.id, clubStatus: u.clubStatus }, data: { clubStatus: next, clubReviewedAt: new Date() } });
      if (!claimed.count) continue;
      const subject = club ? `${club.name} est sur Miabe Esport` : `Ton club « ${name} » et Miabe Esport`;
      const html = club
        ? `<p>Bonjour ${escapeHtml(u.displayName)},</p><p><b>${escapeHtml(club.name)}</b> a rejoint la plateforme. Tu peux maintenant envoyer ta demande d'adhésion depuis ton espace, rubrique <b>Mon club</b> : le gestionnaire du club la validera.</p>`
        : `<p>Bonjour ${escapeHtml(u.displayName)},</p><p>Ton compte est actif : tu peux t'inscrire aux tournois et utiliser tout le site.</p><p>Le club <b>${escapeHtml(name)}</b> n'est pas encore sur la plateforme. Invite ses responsables à créer un compte association : dès qu'il aura rejoint la plateforme, nous te préviendrons pour que tu envoies ta demande d'adhésion, que son gestionnaire validera.</p>`;
      const sent = await this.mail.send(u.email, `${subject} — Miabe Esport`, this.mail.layout(subject, html, { label: 'Ouvrir mon espace', url: `${this.mail.siteUrl}/#profil/compte` })).catch(() => false);
      if (!sent) await this.prisma.user.updateMany({ where: { id: u.id, clubStatus: next }, data: { clubStatus: u.clubStatus } });
    }
  }

  /* ---------- Mécanique ---------- */

  /** Rend une adhésion active : l'ancien club est quitté (et prévenu), les autres demandes du joueur tombent. */
  private async activate(membershipId: string) {
    const left = await this.prisma.$transaction(async (tx) => {
      const m = await tx.clubMembership.findUnique({ where: { id: membershipId }, include: { player: true } });
      if (!m) throw new NotFoundException('Adhésion introuvable.');
      const now = new Date();
      const previous = await tx.clubMembership.findFirst({ where: { playerId: m.playerId, status: 'active' } });
      if (previous) await tx.clubMembership.update({ where: { id: previous.id }, data: { status: 'left', endedAt: now } });
      await tx.clubMembership.updateMany({
        where: { playerId: m.playerId, id: { not: m.id }, OR: [{ status: 'requested' }, { status: 'invited', clubId: m.clubId }] },
        data: { status: 'cancelled', endedAt: now },
      });
      await tx.clubMembership.update({ where: { id: m.id }, data: { status: 'active', decidedAt: now, endedAt: null } });
      await tx.player.update({ where: { id: m.playerId }, data: { clubId: m.clubId } });
      return previous && previous.clubId !== m.clubId ? { clubId: previous.clubId, name: m.player.name } : null;
    });
    if (left) await this.notifyClub(left.clubId, `${left.name} a quitté ton club`, 'Départ d\'un membre', `<p><b>${escapeHtml(left.name)}</b> a rejoint un autre club.</p>`);
  }

  private async end(membershipId: string, playerId: string, status: 'left' | 'removed') {
    await this.prisma.$transaction([
      this.prisma.clubMembership.update({ where: { id: membershipId }, data: { status, endedAt: new Date() } }),
      this.prisma.player.update({ where: { id: playerId }, data: { clubId: null } }),
    ]);
  }

  private async notify(to: string, subject: string, html: string, cta?: { label: string; url: string }) {
    try {
      await this.mail.send(to, `${subject} — Miabe Esport`, this.mail.layout(subject, html, cta));
    } catch { /* best-effort */ }
  }

  /** E-mail au responsable du club (à défaut, à l'adresse de contact). */
  private async notifyClub(clubId: string, subject: string, title: string, html: string) {
    try {
      const club = await this.prisma.club.findUnique({ where: { id: clubId }, select: { contactEmail: true, owner: { select: { email: true } } } });
      const to = club?.owner?.email || club?.contactEmail;
      if (!to) return;
      await this.mail.send(to, `${subject} — Miabe Esport`, this.mail.layout(title, html, { label: 'Ouvrir Mon club', url: `${this.mail.siteUrl}/#profil/club` }));
    } catch { /* best-effort */ }
  }
}
