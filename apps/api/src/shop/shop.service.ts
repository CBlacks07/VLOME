import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './shop.dto';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { LoyaltyReason } from '../../generated/prisma';
import { MailService, escapeHtml } from '../mail/mail.service';

const DEMO_PRODUCTS = [
  { name: 'Maillot officiel Miabe', category: 'Vêtements', priceXof: 15000, stock: 50 },
  { name: 'Hoodie Team Mawu', category: 'Vêtements', priceXof: 25000, stock: 30 },
  { name: 'Casquette Miabe', category: 'Goodies', priceXof: 8000, stock: 80 },
  { name: 'Mug gamer édition Lomé', category: 'Goodies', priceXof: 5000, stock: 120 },
  { name: 'Tapis de souris XL', category: 'Goodies', priceXof: 12000, stock: 60 },
  { name: 'Billet Survival Cup', category: 'Billets', priceXof: 3000, stock: 200 },
  { name: 'Pass LAN Gaming Arena', category: 'Billets', priceXof: 6000, stock: 150 },
  { name: 'Carte cadeau 10 000 F', category: 'Cartes cadeaux', priceXof: 10000, stock: 999 },
];

@Injectable()
export class ShopService {
  constructor(private prisma: PrismaService, private loyalty: LoyaltyService, private mail: MailService) {}

  async listProducts() {
    return this.prisma.product.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async seedProducts() {
    const count = await this.prisma.product.count();
    if (count > 0) return { seeded: false, count };
    await this.prisma.product.createMany({ data: DEMO_PRODUCTS });
    return { seeded: true, count: DEMO_PRODUCTS.length };
  }

  async createOrder(dto: CreateOrderDto, userId?: string) {
    const total = dto.items.reduce((a, i) => a + i.priceXof, 0);

    // Réduction en points fidélité : uniquement sur la part du panier composée de produits
    // marqués éligibles par l'admin. Le prix de chaque article reste tel que soumis par le
    // client (même niveau de confiance que pour totalXof — pas de re-calcul serveur ici).
    let pointsUsed = 0;
    let netTotal = total;
    if (userId && dto.pointsToRedeem) {
      const productIds = dto.items.map((i) => i.productId).filter((x): x is string => !!x);
      const eligibleIds = productIds.length
        ? new Set((await this.prisma.product.findMany({
            where: { id: { in: productIds }, loyaltyEligible: true },
            select: { id: true },
          })).map((p) => p.id))
        : new Set<string>();
      const eligibleAmount = dto.items.filter((i) => i.productId && eligibleIds.has(i.productId)).reduce((a, i) => a + i.priceXof, 0);
      if (eligibleAmount > 0) {
        const maxPoints = await this.loyalty.maxRedeemablePoints(userId, eligibleAmount, total);
        pointsUsed = Math.min(dto.pointsToRedeem, maxPoints);
        if (pointsUsed > 0) {
          const settings = await this.loyalty.getSettings();
          netTotal = Math.max(0, total - pointsUsed * settings.pointValueXof);
        }
      }
    }

    const reference = 'VL-' + Date.now().toString(36).toUpperCase();
    const order = await this.prisma.order.create({
      data: {
        reference, totalXof: netTotal, paymentMethod: dto.paymentMethod, status: 'pending',
        userId: userId ?? null, pointsRedeemed: pointsUsed,
        items: dto.items.map((i) => ({ name: i.name, price: i.priceXof })),
      },
    });
    if (pointsUsed > 0) {
      try {
        await this.loyalty.redeem(userId!, pointsUsed, LoyaltyReason.ORDER_REDEMPTION, { orderId: order.id });
      } catch (e) {
        await this.prisma.order.delete({ where: { id: order.id } });
        throw e;
      }
    }
    await this.notifyOrder(userId, order.reference, order.totalXof, order.paymentMethod, dto.items.map((i) => i.name), pointsUsed);
    return {
      id: order.id, reference: order.reference, totalXof: order.totalXof,
      paymentMethod: order.paymentMethod, status: order.status, pointsRedeemed: pointsUsed,
    };
  }

  /** Reçu de commande. Best-effort : une commande valide ne doit jamais échouer sur un e-mail. */
  private async notifyOrder(userId: string | undefined, reference: string, totalXof: number, paymentMethod: string, items: string[], pointsUsed: number) {
    if (!userId) return; // commande sans compte : pas d'adresse connue
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });
    if (!u) return;
    await this.mail.send(
      u.email,
      `Commande ${reference} enregistrée — Miabe Esport`,
      this.mail.layout(
        'Merci pour ta commande',
        `<p>Bonjour ${escapeHtml(u.displayName)},</p>
         <p>Ta commande <b>${escapeHtml(reference)}</b> est bien enregistrée.</p>
         <ul>${items.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
         <p>Total : <b>${totalXof.toLocaleString('fr-FR')} F</b> · Paiement : <b>${escapeHtml(paymentMethod)}</b>${pointsUsed > 0 ? ` · <b>${pointsUsed} point${pointsUsed > 1 ? 's' : ''}</b> de fidélité utilisé${pointsUsed > 1 ? 's' : ''}` : ''}</p>
         <p>Elle sera confirmée par l'équipe Miabe Esport à réception du paiement.</p>`,
        { label: 'Voir mes commandes', url: `${this.mail.siteUrl}/#profil` },
      ),
    );
  }
}
