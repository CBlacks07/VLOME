import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NewsDto, NewsUpdateDto, ProductDto, ProductUpdateDto } from './admin.dto';
import { DEFAULT_LOYALTY_SETTINGS } from '../loyalty/loyalty.service';
import { CreditsService, DEFAULT_CREDITS_SETTINGS } from '../credits/credits.service';
import { SESSION_SECRET_CONFIGURED } from '../auth/auth.module';
import { MailService, escapeHtml } from '../mail/mail.service';
import { uniqueClubSlug } from '../common/slug';
import { DEFAULT_PREDICTIONS_SETTINGS, DEFAULT_TIER_POINTS_SETTINGS } from '../common/settings-defaults';
export { DEFAULT_PREDICTIONS_SETTINGS, DEFAULT_TIER_POINTS_SETTINGS };

/** Clés de réglages éditables + valeurs par défaut (contenu de lancement). */
export const SETTING_KEYS = ['brand', 'hero', 'slides', 'partners', 'ads', 'loyalty', 'credits', 'predictions', 'tierPoints', 'legal', 'privacy'] as const;
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  brand: { name1: 'Miabe', name2: 'ESPORT', logoUrl: null },
  loyalty: DEFAULT_LOYALTY_SETTINGS,
  credits: DEFAULT_CREDITS_SETTINGS,
  predictions: DEFAULT_PREDICTIONS_SETTINGS,
  tierPoints: DEFAULT_TIER_POINTS_SETTINGS,
  hero: {
    kicker: 'Miabe Esport · Togo',
    title: "LE HUB DE L'ESPORT\nTOGOLAIS & OUEST-AFRICAIN",
    subtitle: 'Compétitions, classements, communauté et boutique — une seule plateforme pour fédérer les gamers du Togo et professionnaliser l\'esport de la région.',
    stats: [
      { v: '2 400+', k: 'Joueurs' },
      { v: '18', k: 'Tournois / an' },
      { v: '24', k: 'Clubs' },
    ],
  },
  slides: [
    { tag: 'Grand tournoi', title: 'SURVIVAL CUP LOMÉ 2026', sub: '32 joueurs, mode Survival — le vainqueur reste sur le terrain. Cagnotte 160 points.', cta: "S'inscrire" },
    { tag: 'Nouveau', title: 'FREE FIRE TOGO SERIES', sub: '48 joueurs en Battle Royale sur 3 jours. Qualifications en ligne ouvertes.', cta: 'Voir le tournoi' },
    { tag: 'Communauté', title: 'GAMING ARENA LOMÉ', sub: 'LAN mensuelle : viens jouer, streamer et rencontrer la communauté esport togolaise.', cta: 'Découvrir' },
  ],
  partners: ['Gaming Arena Lomé', 'Yas Togo', 'Moov Africa', 'Université de Lomé', 'CIC Lomé', 'Togocom']
    .map((name) => ({ name, logoUrl: null as string | null })),
  // Pages légales, éditables depuis l'admin (onglet « Pages légales »). Les passages entre
  // crochets restent volontairement visibles : un oubli doit sauter aux yeux plutôt que de
  // passer inaperçu sur un site public.
  legal: { title: 'Mentions légales', body: "## Éditeur du site\nLe présent site est édité par SANT-ANNA Abdel Samad, entrepreneur individuel, dont le siège est situé 131 boulevard Malfakasa, Bè-Kpota, Lomé, Togo.\nRCCM : TG-LOM 2009 A 2479 du 04/12/2009 · NIF : 1000047421\nDirecteur de la publication : SANT-ANNA Abdel Samad\nContact : miabeapeto@miabe-esport.community · +228 90 12 54 50\n\n## Hébergement\nLe site et son interface de programmation sont hébergés par Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis — vercel.com.\nLes images et vidéos sont hébergées par Cloudinary. La base de données est hébergée par Neon Inc. (États-Unis). Les e-mails sont acheminés par Zoho Corporation.\n\n## Propriété intellectuelle\nLa structure du site, ses textes et son identité visuelle sont la propriété de l'éditeur. Les photographies et vidéos publiées dans la galerie restent la propriété de leurs auteurs et sont diffusées avec leur accord.\nToute reproduction, même partielle, est soumise à l'autorisation préalable de l'éditeur.\n\n## Contenus publiés par les utilisateurs\nLes organisateurs et les membres sont responsables des contenus qu'ils publient (noms de tournois, pseudonymes, descriptions). L'éditeur se réserve le droit de retirer sans préavis tout contenu illicite, injurieux ou portant atteinte aux droits d'un tiers.\n\n## Responsabilité\nL'éditeur s'efforce d'assurer l'exactitude des informations publiées et la disponibilité du service, sans pouvoir la garantir. Sa responsabilité ne saurait être engagée en cas d'interruption du service, de perte de données, ou de litige survenu entre participants et organisateurs lors d'un tournoi.\n\n## Signalement\nTout contenu que vous jugez inapproprié peut être signalé à miabeapeto@miabe-esport.community. Nous nous engageons à l'examiner dans les meilleurs délais." },
  privacy: { title: 'Politique de confidentialité', body: "Cette politique décrit les données que nous collectons, pourquoi, et les droits dont vous disposez. Elle s'applique au site miabe-esport.community.\n\n## Responsable du traitement\nSANT-ANNA Abdel Samad, entrepreneur individuel, 131 boulevard Malfakasa, Bè-Kpota, Lomé, Togo. Contact : miabeapeto@miabe-esport.community · +228 90 12 54 50.\n\n## Données que nous collectons\n- Compte : adresse e-mail, mot de passe (jamais conservé en clair — uniquement une empreinte chiffrée), pseudonyme, rôle, date d'inscription.\n- Profil, facultatif : présentation, ville, jeu favori, numéro de téléphone ou WhatsApp, club.\n- Organisateurs : la demande de motivation transmise à l'inscription, le statut de validation, les plafonds fixés et le solde de crédits.\n- Activité : inscriptions aux tournois, résultats sportifs, commandes en boutique, points de fidélité et historique des transactions associées.\n- Médias : photographies et vidéos publiées dans la galerie, sur lesquelles des participants peuvent apparaître.\n\nNous ne collectons aucune donnée bancaire. Les paiements se règlent hors du site : seul le nom du moyen de paiement annoncé (Flooz, Mixx by Yas, espèces…) est conservé, afin que l'équipe puisse rapprocher le règlement de l'inscription.\n\n## Pourquoi nous les utilisons\n- Tenir votre compte et vous authentifier.\n- Gérer les inscriptions aux tournois, établir les classements et attribuer les points.\n- Traiter les commandes de la boutique et les achats de crédits organisateur.\n- Vous contacter au sujet de votre compte : validation d'une demande d'organisateur, confirmation d'inscription ou de commande, réinitialisation de mot de passe.\n- Faire vivre la communauté à travers la galerie et les actualités.\n\n## Traceurs\nLe site ne dépose aucun cookie et n'utilise aucun outil de mesure d'audience ni de publicité : ni Google Analytics, ni réseaux sociaux, ni régie publicitaire tierce.\nUn jeton de session est conservé dans la mémoire locale de votre navigateur, uniquement pour vous éviter de vous reconnecter à chaque visite. Il disparaît à la déconnexion.\nLes polices de caractères sont chargées depuis Google Fonts, ce qui implique une connexion de votre navigateur aux serveurs de Google.\n\n## Qui d'autre y a accès\nNous ne vendons ni ne louons vos données. Elles sont confiées aux prestataires strictement nécessaires au fonctionnement du site :\n- Vercel (États-Unis) — hébergement du site et de l'interface de programmation.\n- Cloudinary — stockage des images et vidéos.\n- Zoho Mail — acheminement des e-mails que nous vous envoyons.\n- Neon Inc. (États-Unis) — hébergement de la base de données.\n\nCertains de ces prestataires étant situés hors du Togo, vos données peuvent être transférées à l'étranger dans ce cadre.\n\n## Combien de temps nous les gardons\n- Compte : tant qu'il est actif, puis 3 ans après votre dernière connexion.\n- Commandes et inscriptions payantes : conservées pour la durée légale de conservation des pièces comptables.\n- Liens de réinitialisation de mot de passe : une heure, puis inutilisables.\n- Médias de la galerie : jusqu'à leur retrait par l'équipe ou sur votre demande.\n\n## Vos droits\nConformément à la loi togolaise n° 2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel, vous pouvez demander l'accès à vos données, leur rectification, leur effacement, ou vous opposer à leur traitement.\nLa plupart de ces actions sont immédiates depuis votre espace : Mon compte permet de modifier votre profil et votre mot de passe. Pour le reste, écrivez à miabeapeto@miabe-esport.community — nous répondons dans les meilleurs délais.\nVous pouvez également saisir l'Instance de protection des données à caractère personnel (IPDCP) du Togo.\n\n## Photographies\nSi vous apparaissez sur une photo ou une vidéo de la galerie et souhaitez son retrait, écrivez-nous : nous la retirons sans avoir à nous en justifier.\n\n## Mineurs\nL'inscription est réservée aux personnes âgées d'au moins 13 ans. En dessous de 16 ans, elle suppose l'accord d'un parent ou tuteur.\nUn parent ou tuteur peut à tout moment demander la consultation, la rectification ou la suppression du compte d'un mineur, ainsi que le retrait des photographies sur lesquelles il apparaît, en écrivant à miabeapeto@miabe-esport.community.\n\n## Sécurité\nLes mots de passe sont conservés sous forme d'empreintes chiffrées et ne sont jamais lisibles, y compris par l'équipe. Les échanges avec le site sont chiffrés (HTTPS). En cas de perte de votre mot de passe, un lien de réinitialisation à usage unique vous est envoyé par e-mail.\n\n## Modifications\nCette politique peut évoluer. La date de dernière mise à jour figure en bas de la page." },
  ads: [] as { imageUrl: string; linkUrl: string; label: string }[],
};

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService, private credits: CreditsService, private mail: MailService) {}

  /* ---------- Crédits organisateur ---------- */

  pendingCreditPurchases() {
    return this.credits.pendingPurchases();
  }

  confirmCreditPurchase(id: string) {
    return this.credits.confirmPurchase(id);
  }

  /* ---------- Utilisateurs ---------- */

  async listUsers() {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true, ownedClub: { select: { id: true, name: true } } },
    });
    // ownsClub : ce compte pilote une association (même si son rôle a été changé par erreur — l'admin peut alors le rétablir).
    return rows.map(({ ownedClub, ...u }) => ({ ...u, ownsClub: !!ownedClub, ownedClubName: ownedClub?.name ?? null }));
  }

  /** Change le rôle d'un compte. Un compte qui pilote une association ne peut pas devenir joueur/organisateur/admin (il perdrait son espace
   *  « Mon club » et le club resterait sans responsable) ; à l'inverse, « Association » n'est accordé qu'à un compte qui pilote un club. */
  async setRole(id: string, role: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { ownedClub: { select: { name: true } } } });
    if (!u) throw new NotFoundException('Utilisateur introuvable.');
    if (role === 'ASSOCIATION' && !u.ownedClub) {
      throw new BadRequestException('Aucune association n\'est rattachée à ce compte : utilise « Rattacher un compte » sur un club sans association.');
    }
    // Un responsable de club peut être association, organisateur ou admin ; joueur, il perdrait l'accès à « Mon club ».
    if (role === 'PLAYER' && u.ownedClub) {
      throw new BadRequestException(`Ce compte pilote l'association « ${u.ownedClub.name} » : il ne peut pas redevenir simple joueur.`);
    }
    return this.prisma.user.update({
      where: { id },
      data: { role: role as any },
      select: { id: true, email: true, displayName: true, role: true },
    });
  }

  /**
   * Supprime définitivement un compte (inscriptions et transactions liées suivent en cascade).
   * Deux garde-fous : on ne peut pas supprimer son propre compte (on se couperait l'accès en
   * pleine action), ni le dernier administrateur restant (plus personne ne pourrait administrer).
   * Les tournois créés par ce compte sont conservés — seuls les administrateurs pourront les gérer.
   */
  async removeUser(id: string, requesterId: string) {
    if (id === requesterId) throw new BadRequestException('Tu ne peux pas supprimer ton propre compte.');
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
    if (!u) throw new NotFoundException('Utilisateur introuvable.');
    if (u.role === 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (admins <= 1) throw new BadRequestException('Impossible de supprimer le dernier administrateur.');
    }
    await this.prisma.user.delete({ where: { id } });
    return { deleted: true, email: u.email };
  }

  /**
   * Attribue un mot de passe temporaire à un membre qui ne parvient plus à se connecter.
   * Évite d'avoir à supprimer puis recréer le compte, ce qui ferait perdre son historique
   * (inscriptions, commandes, points de fidélité) et son rôle.
   *
   * Le mot de passe est renvoyé UNE seule fois à l'administrateur, et envoyé à l'intéressé par
   * e-mail si la messagerie est configurée. Il reste temporaire : à changer depuis « Mon compte ».
   */
  async resetUserPassword(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true, displayName: true } });
    if (!u) throw new NotFoundException('Utilisateur introuvable.');
    // Lisible et dictable au téléphone (pas de caractères ambigus), tout en restant imprévisible.
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(12);
    const password = 'Miabe-' + Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join('');
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    // Toute demande de réinitialisation en cours devient caduque : le mot de passe vient de changer.
    await this.prisma.passwordReset.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    const emailed = await this.mail.send(
      u.email,
      'Ton mot de passe a été réinitialisé — Miabe Esport',
      this.mail.layout(
        'Nouveau mot de passe temporaire',
        `<p>Bonjour ${escapeHtml(u.displayName)},</p>
         <p>L'équipe Miabe Esport vient de réinitialiser ton mot de passe. Utilise celui-ci pour te connecter :</p>
         <p style="font-family:monospace;font-size:18px;letter-spacing:1px;background:#0B0B11;border:1px solid #282838;border-radius:10px;padding:14px;text-align:center">${escapeHtml(password)}</p>
         <p>Change-le dès ta connexion depuis « Mon compte ».</p>`,
        { label: 'Me connecter', url: `${this.mail.siteUrl}/#connexion` },
      ),
    );
    return { password, email: u.email, emailed };
  }

  /* ---------- Demandes de club ---------- */

  /** Demandes de club « libres » (anciennes inscriptions) ou visant un club sans association propriétaire : l'admin les traite lui-même.
   *  Les adhésions à un club piloté par une association sont validées par cette association, pas ici. */
  async listClubRequests() {
    const rows = await this.prisma.user.findMany({
      where: { clubStatus: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, displayName: true, city: true, createdAt: true, clubRequested: true, clubRequestedId: true, clubBlocking: true },
    });
    const ids = rows.map((r) => r.clubRequestedId).filter((x): x is string => !!x);
    const owned = new Set((ids.length ? await this.prisma.club.findMany({ where: { id: { in: ids }, ownerId: { not: null } }, select: { id: true } }) : []).map((c) => c.id));
    return rows.filter((r) => !r.clubRequestedId || !owned.has(r.clubRequestedId)).map(({ clubRequestedId: _omit, ...rest }) => rest);
  }

  /** Valide (le club entre alors dans le catalogue et sur la fiche joueur, le compte est débloqué) ou refuse (compte débloqué, sans club). */
  async reviewClubRequest(id: string, status: 'APPROVED' | 'REJECTED') {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || u.clubStatus !== 'PENDING' || !u.clubRequested) throw new NotFoundException('Aucune demande de club en attente pour ce compte.');
    const name = u.clubRequested.trim();
    if (status === 'APPROVED') {
      const existing = await this.prisma.club.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      const clubId = existing ? existing.id : (await this.prisma.club.create({ data: { name, slug: await uniqueClubSlug(this.prisma, name) } })).id;
      const player = await this.prisma.player.findFirst({ where: { userId: id } });
      if (player) await this.prisma.player.update({ where: { id: player.id }, data: { clubId } });
      else if (u.role === 'PLAYER') await this.prisma.player.create({ data: { name: u.displayName, city: u.city, userId: id, clubId } });
    }
    await this.prisma.user.update({
      where: { id },
      data: { clubStatus: status, clubBlocking: false, clubRequested: null, clubRequestedId: null, clubReviewedAt: new Date() },
    });
    await this.notifyClubReviewed(u.email, u.displayName, name, status);
    return { id, status };
  }

  /** Prévient le joueur de la décision. Best-effort : jamais bloquant. */
  private async notifyClubReviewed(email: string, displayName: string, club: string, status: 'APPROVED' | 'REJECTED') {
    const ok = status === 'APPROVED';
    await this.mail.send(
      email,
      ok ? 'Ton club est validé — Miabe Esport' : 'Ton club n\'a pas été retenu — Miabe Esport',
      this.mail.layout(
        ok ? 'Club validé' : 'Club non retenu',
        ok
          ? `<p>Bonjour ${escapeHtml(displayName)},</p><p>Ton club <b>${escapeHtml(club)}</b> a été validé. Ton compte est maintenant actif : tu peux t'inscrire aux tournois et utiliser tout le site.</p>`
          : `<p>Bonjour ${escapeHtml(displayName)},</p><p>Le club <b>${escapeHtml(club)}</b> n'a pas été retenu pour le moment. Ton compte est quand même actif, sans club : tu peux t'inscrire aux tournois et utiliser tout le site.</p>`,
      ),
    ).catch(() => { /* best-effort */ });
  }

  /* ---------- Organisateurs (validation, plafonds) ---------- */

  async listOrganizers() {
    const rows = await this.prisma.user.findMany({
      where: { role: 'ORGANIZER' },
      orderBy: [{ organizerStatus: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, email: true, displayName: true, phone: true, createdAt: true,
        organizerStatus: true, organizerNote: true, organizerMaxTournaments: true, organizerMaxPlayers: true, organizerReviewedAt: true,
      },
    });
    const counts = await this.prisma.tournament.groupBy({ by: ['createdById'], _count: true, where: { createdById: { in: rows.map((r) => r.id) } } });
    const byOwner = new Map(counts.map((c) => [c.createdById, c._count]));
    return rows.map((r) => ({ ...r, tournamentCount: byOwner.get(r.id) ?? 0 }));
  }

  async reviewOrganizer(id: string, status: 'APPROVED' | 'REJECTED', maxTournaments?: number | null, maxPlayers?: number | null) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || u.role !== 'ORGANIZER') throw new NotFoundException('Organisateur introuvable.');
    const alreadyApproved = u.organizerStatus === 'APPROVED';
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        organizerStatus: status,
        organizerReviewedAt: new Date(),
        ...(maxTournaments !== undefined ? { organizerMaxTournaments: maxTournaments } : {}),
        ...(maxPlayers !== undefined ? { organizerMaxPlayers: maxPlayers } : {}),
      },
      select: { id: true, organizerStatus: true, organizerMaxTournaments: true, organizerMaxPlayers: true },
    });
    // Pas d'e-mail quand on ne fait que réajuster les plafonds d'un organisateur déjà approuvé :
    // il recevrait un « bienvenue » à chaque modification.
    if (!(alreadyApproved && status === 'APPROVED')) {
      await this.notifyOrganizerReviewed(u.email, u.displayName, status, updated.organizerMaxTournaments, updated.organizerMaxPlayers);
    }
    return updated;
  }

  /** Prévient le candidat organisateur de la décision. Best-effort : jamais bloquant. */
  private async notifyOrganizerReviewed(email: string, name: string, status: 'APPROVED' | 'REJECTED', maxT: number | null, maxP: number | null) {
    if (status === 'REJECTED') {
      await this.mail.send(
        email,
        "Ta demande d'organisateur — Miabe Esport",
        this.mail.layout(
          "Demande d'organisateur refusée",
          `<p>Bonjour ${escapeHtml(name)},</p>
           <p>Ta demande pour organiser des tournois sur Miabe Esport n'a pas été retenue pour le moment.</p>
           <p>Tu peux continuer à participer aux tournois avec ton compte. Si tu penses qu'il s'agit d'une erreur, réponds simplement à cet e-mail.</p>`,
        ),
      );
      return;
    }
    const limits = [
      maxT != null ? `<li>Jusqu'à <b>${maxT} tournoi${maxT > 1 ? 's' : ''}</b> au total</li>` : '',
      maxP != null ? `<li>Jusqu'à <b>${maxP} participant${maxP > 1 ? 's' : ''}</b> par tournoi</li>` : '',
    ].filter(Boolean).join('');
    await this.mail.send(
      email,
      'Ton compte organisateur est validé — Miabe Esport',
      this.mail.layout(
        'Bienvenue parmi les organisateurs',
        `<p>Bonjour ${escapeHtml(name)},</p>
         <p>Ton compte organisateur vient d'être validé : tu peux dès maintenant créer et piloter tes tournois.</p>
         ${limits ? `<p>Conditions fixées pour ton compte :</p><ul>${limits}</ul>` : ''}
         <p>Ton premier tournoi est offert. Ensuite, chaque tournoi hébergé consomme un crédit, achetable depuis l'onglet « Crédits ».</p>`,
        { label: 'Créer mon premier tournoi', url: `${this.mail.siteUrl}/#profil` },
      ),
    );
  }

  async overview() {
    const [users, tournaments, orders, products, admins, organizers, news, pendingPayments, gallery] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.tournament.count(),
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.user.count({ where: { role: 'ORGANIZER' } }),
      this.prisma.newsPost.count(),
      this.prisma.registration.count({ where: { paymentStatus: 'pending' } }),
      this.prisma.galleryItem.count(),
    ]);
    return {
      users, admins, organizers, tournaments, orders, products, news, pendingPayments, gallery,
      // Diagnostic d'exploitation : sans JWT_SECRET, les sessions sautent à chaque redémarrage
      // d'instance. Booléen uniquement — la valeur du secret n'est évidemment jamais exposée.
      sessionSecretConfigured: SESSION_SECRET_CONFIGURED,
    };
  }

  /* ---------- Paiements d'inscription (vue d'ensemble) ---------- */

  listPayments() {
    return this.prisma.registration.findMany({
      where: { amountXof: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { email: true, displayName: true } },
        tournament: { select: { id: true, name: true } },
      },
    });
  }

  /* ---------- Actualités ---------- */

  private slugify(title: string) {
    const base = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'article';
    return `${base}-${Date.now().toString(36)}`;
  }

  listNews() {
    return this.prisma.newsPost.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createNews(dto: NewsDto) {
    return this.prisma.newsPost.create({
      data: {
        title: dto.title.trim(), slug: this.slugify(dto.title),
        category: dto.category.trim() || 'Actualité', body: dto.body,
        imageUrl: dto.imageUrl || null,
        published: dto.published ?? true,
      },
    });
  }

  async updateNews(id: string, dto: NewsUpdateDto) {
    const n = await this.prisma.newsPost.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Article introuvable');
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title.trim() || n.title;
    if (dto.category !== undefined) data.category = dto.category.trim() || n.category;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl || null;
    if (dto.published !== undefined) data.published = dto.published;
    return this.prisma.newsPost.update({ where: { id }, data });
  }

  async deleteNews(id: string) {
    const n = await this.prisma.newsPost.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Article introuvable');
    await this.prisma.newsPost.delete({ where: { id } });
    return { deleted: true };
  }

  /* ---------- Produits ---------- */

  listProducts() {
    return this.prisma.product.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  createProduct(dto: ProductDto) {
    return this.prisma.product.create({
      data: {
        name: dto.name.trim(), category: dto.category.trim() || 'Goodies',
        priceXof: dto.priceXof, stock: dto.stock, imageUrl: dto.imageUrl || null,
        loyaltyEligible: dto.loyaltyEligible ?? false,
        showOnHome: dto.showOnHome ?? false,
        description: dto.description?.trim() || null,
      },
    });
  }

  async updateProduct(id: string, dto: ProductUpdateDto) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Produit introuvable');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim() || p.name;
    if (dto.category !== undefined) data.category = dto.category.trim() || p.category;
    if (dto.priceXof !== undefined) data.priceXof = dto.priceXof;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl || null;
    if (dto.loyaltyEligible !== undefined) data.loyaltyEligible = dto.loyaltyEligible;
    if (dto.showOnHome !== undefined) data.showOnHome = dto.showOnHome;
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    return this.prisma.product.update({ where: { id }, data });
  }

  async deleteProduct(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Produit introuvable');
    await this.prisma.product.delete({ where: { id } });
    return { deleted: true };
  }

  /* ---------- Réglages du site ---------- */

  /** Réglages fusionnés : valeurs stockées, défauts sinon. */
  async getSettings() {
    const rows = await this.prisma.setting.findMany();
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    // Le compteur de visiteurs (voir VisitsService) vit dans la même table mais n'est pas un réglage du site : il ne sort pas ici.
    rows.filter((r) => r.key !== 'visitors' && r.key !== 'presence').forEach((r) => { out[r.key] = r.value; });
    return out;
  }

  setSetting(key: string, value: unknown) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException('Clé de réglage inconnue.');
    }
    const v = JSON.parse(JSON.stringify(value ?? null));
    return this.prisma.setting.upsert({
      where: { key },
      update: { value: v },
      create: { key, value: v },
    });
  }

  /* ---------- Commandes ---------- */

  recentOrders() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { email: true, displayName: true } } },
    });
  }

  /** Masque (ou ré-affiche) une commande dans la liste admin. Rien n'est supprimé : elle reste dans les chiffres et l'historique du client. */
  async setOrderArchived(id: string, archived: boolean) {
    const o = await this.prisma.order.findUnique({ where: { id }, select: { id: true } });
    if (!o) throw new NotFoundException('Commande introuvable');
    return this.prisma.order.update({ where: { id }, data: { archived } });
  }

  /** Supprime définitivement une commande restée « en attente » (jamais payée, jamais annulée). Une commande encaissée, livrée ou annulée
   *  est une pièce de l'historique : elle ne se supprime pas, on l'archive pour la masquer de la liste. */
  async deleteOrder(id: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Commande introuvable');
    if (o.status !== 'pending') {
      throw new ConflictException('Une commande encaissée, livrée ou annulée ne peut pas être supprimée : archive-la pour la masquer de la liste.');
    }
    await this.prisma.$transaction([
      this.prisma.onlinePayment.deleteMany({ where: { kind: 'order', refId: id } }),
      this.prisma.order.delete({ where: { id } }),
    ]);
    return { id, deleted: true };
  }

  /** Changements de statut permis : en attente → payée ou annulée ; payée → livrée. Une commande encaissée, livrée ou annulée est figée :
   *  on ne « dépaie » pas, on ne ressuscite pas une commande annulée, on ne change pas une commande livrée. */
  async setOrderStatus(id: string, status: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Commande introuvable');
    if (o.status === status) return o;
    const allowed: Record<string, string[]> = { pending: ['paid', 'cancelled'], paid: ['delivered'], delivered: [], cancelled: [] };
    if (!(allowed[o.status] ?? []).includes(status)) {
      throw new ConflictException(o.status === 'cancelled'
        ? 'Une commande annulée ne peut plus être modifiée.'
        : o.status === 'delivered'
          ? 'Une commande livrée ne peut plus être modifiée.'
          : o.status === 'paid'
            ? 'Une commande encaissée ne peut plus être annulée ni modifiée : seule sa livraison peut être enregistrée.'
            : 'Changement de statut non autorisé.');
    }
    return this.prisma.order.update({ where: { id }, data: { status } });
  }
}
