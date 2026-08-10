import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NewsDto, NewsUpdateDto, ProductDto, ProductUpdateDto } from './admin.dto';
import { DEFAULT_LOYALTY_SETTINGS } from '../loyalty/loyalty.service';
import { CreditsService, DEFAULT_CREDITS_SETTINGS } from '../credits/credits.service';
import { SESSION_SECRET_CONFIGURED } from '../auth/auth.module';
import { MailService, escapeHtml } from '../mail/mail.service';

/** Clés de réglages éditables + valeurs par défaut (contenu de lancement). */
export const SETTING_KEYS = ['brand', 'hero', 'slides', 'partners', 'ads', 'loyalty', 'credits'] as const;
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  brand: { name1: 'Miabe', name2: 'ESPORT', logoUrl: null },
  loyalty: DEFAULT_LOYALTY_SETTINGS,
  credits: DEFAULT_CREDITS_SETTINGS,
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

  listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
    });
  }

  setRole(id: string, role: string) {
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
    rows.forEach((r) => { out[r.key] = r.value; });
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

  async setOrderStatus(id: string, status: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Commande introuvable');
    return this.prisma.order.update({ where: { id }, data: { status } });
  }
}
