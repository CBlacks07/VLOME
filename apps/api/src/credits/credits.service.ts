import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreditReason } from '../../generated/prisma';
import { MailService, escapeHtml } from '../mail/mail.service';

/** Valeurs par défaut tant que l'admin n'a rien réglé (Setting key "credits"). */
export const DEFAULT_CREDITS_SETTINGS = { priceXof: 750, freeTournaments: 1 };

@Injectable()
export class CreditsService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  async getSettings(): Promise<{ priceXof: number; freeTournaments: number }> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'credits' } });
    const v = (row?.value as Partial<typeof DEFAULT_CREDITS_SETTINGS>) ?? {};
    return {
      priceXof: v.priceXof && v.priceXof > 0 ? v.priceXof : DEFAULT_CREDITS_SETTINGS.priceXof,
      freeTournaments: v.freeTournaments !== undefined ? Math.max(0, v.freeTournaments) : DEFAULT_CREDITS_SETTINGS.freeTournaments,
    };
  }

  /** Un organisateur peut-il créer un tournoi (gratuit ou crédité) sans rien consommer pour l'instant ? */
  async canHost(userId: string): Promise<{ ok: boolean; free: boolean }> {
    const [settings, u] = await Promise.all([
      this.getSettings(),
      this.prisma.user.findUnique({ where: { id: userId }, select: { freeTournamentsUsed: true, organizerCredits: true } }),
    ]);
    if (!u) return { ok: false, free: false };
    if (u.freeTournamentsUsed < settings.freeTournaments) return { ok: true, free: true };
    if (u.organizerCredits > 0) return { ok: true, free: false };
    return { ok: false, free: false };
  }

  /** À appeler juste après la création réussie d'un tournoi par un organisateur : consomme le tournoi
   * gratuit s'il en reste, sinon débite 1 crédit. Ne relance pas la vérification (déjà faite par canHost
   * juste avant) — si les deux sont épuisés, ne fait rien silencieusement (ne devrait pas arriver). */
  async consumeForHosting(userId: string, tournamentId: string) {
    const settings = await this.getSettings();
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { freeTournamentsUsed: true, organizerCredits: true } });
      if (!u) return;
      if (u.freeTournamentsUsed < settings.freeTournaments) {
        await tx.user.update({ where: { id: userId }, data: { freeTournamentsUsed: { increment: 1 } } });
        return;
      }
      if (u.organizerCredits > 0) {
        await tx.user.update({ where: { id: userId }, data: { organizerCredits: { decrement: 1 } } });
        await tx.creditTransaction.create({ data: { userId, amount: -1, reason: CreditReason.TOURNAMENT_HOST, tournamentId } });
      }
    });
  }

  /** Rembourse 1 crédit si le tournoi supprimé avait bien consommé un crédit (jamais le tournoi gratuit,
   * qui n'est pas remboursable) — évite le contournement "j'héberge, je supprime, je récupère le crédit"
   * en ne remboursant que si l'appelant confirme que le tournoi n'a jamais été lancé. */
  async refundHostingIfApplicable(userId: string, tournamentId: string) {
    const spent = await this.prisma.creditTransaction.findFirst({ where: { tournamentId, reason: CreditReason.TOURNAMENT_HOST } });
    if (!spent) return;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { organizerCredits: { increment: 1 } } }),
      this.prisma.creditTransaction.create({ data: { userId, amount: 1, reason: CreditReason.REFUND, tournamentId, note: 'Tournoi supprimé avant lancement' } }),
    ]);
  }

  /** Résumé complet pour l'espace organisateur : solde, quota gratuit, tarif en vigueur, historique. */
  async meSummary(userId: string) {
    const [settings, u, history, purchases] = await Promise.all([
      this.getSettings(),
      this.prisma.user.findUnique({ where: { id: userId }, select: { organizerCredits: true, freeTournamentsUsed: true } }),
      this.history(userId),
      this.myPurchases(userId),
    ]);
    return {
      balance: u?.organizerCredits ?? 0,
      freeTournamentsUsed: u?.freeTournamentsUsed ?? 0,
      freeTournaments: settings.freeTournaments,
      priceXof: settings.priceXof,
      history,
      purchases,
    };
  }

  async balance(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { organizerCredits: true } });
    return u?.organizerCredits ?? 0;
  }

  async history(userId: string, take = 100) {
    return this.prisma.creditTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
  }

  async requestPurchase(userId: string, credits: number, paymentMethod: string) {
    const settings = await this.getSettings();
    return this.prisma.creditPurchase.create({
      data: { userId, credits, amountXof: credits * settings.priceXof, paymentMethod },
    });
  }

  async myPurchases(userId: string) {
    return this.prisma.creditPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  /** Vue d'ensemble admin — achats de crédits en attente de confirmation. */
  async pendingPurchases() {
    return this.prisma.creditPurchase.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true, displayName: true, phone: true } } },
    });
  }

  async confirmPurchase(id: string) {
    const p = await this.prisma.creditPurchase.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Achat introuvable.');
    if (p.status === 'paid') throw new ConflictException('Cet achat est déjà confirmé.');
    await this.prisma.$transaction([
      this.prisma.creditPurchase.update({ where: { id }, data: { status: 'paid' } }),
      this.prisma.user.update({ where: { id: p.userId }, data: { organizerCredits: { increment: p.credits } } }),
      this.prisma.creditTransaction.create({ data: { userId: p.userId, amount: p.credits, reason: CreditReason.PURCHASE, purchaseId: p.id } }),
    ]);
    await this.notifyPurchaseConfirmed(p.userId, p.credits, p.amountXof);
    return { confirmed: true };
  }

  /** Prévient l'organisateur que ses crédits sont disponibles. Best-effort : jamais bloquant. */
  private async notifyPurchaseConfirmed(userId: string, credits: number, amountXof: number) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true, organizerCredits: true } });
    if (!u) return;
    await this.mail.send(
      u.email,
      'Tes crédits organisateur sont disponibles — Miabe Esport',
      this.mail.layout(
        'Paiement confirmé',
        `<p>Bonjour ${escapeHtml(u.displayName)},</p>
         <p>Nous avons bien reçu ton paiement de <b>${amountXof.toLocaleString('fr-FR')} F</b>. <b>${credits} crédit${credits > 1 ? 's' : ''}</b> ${credits > 1 ? 'ont' : 'a'} été ajouté${credits > 1 ? 's' : ''} à ton compte.</p>
         <p>Nouveau solde : <b>${u.organizerCredits} crédit${u.organizerCredits > 1 ? 's' : ''}</b> — soit autant de tournois que tu peux héberger.</p>`,
        { label: 'Créer un tournoi', url: `${this.mail.siteUrl}/#profil` },
      ),
    );
  }

  async cancelPurchase(id: string, requesterId: string, isAdmin: boolean) {
    const p = await this.prisma.creditPurchase.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Achat introuvable.');
    if (!isAdmin && p.userId !== requesterId) throw new NotFoundException('Achat introuvable.');
    if (p.status === 'paid') throw new BadRequestException('Cet achat est déjà confirmé, impossible à annuler.');
    await this.prisma.creditPurchase.delete({ where: { id } });
    return { cancelled: true };
  }
}
