import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoyaltyReason } from '../../generated/prisma';

/** Valeurs par défaut tant que l'admin n'a rien réglé (Setting key "loyalty"). */
export const DEFAULT_LOYALTY_SETTINGS = { pointValueXof: 100, maxRedeemPercent: 50 };

type TxOpts = { registrationId?: string; orderId?: string; note?: string };

@Injectable()
export class LoyaltyService {
  constructor(private prisma: PrismaService) {}

  async getSettings(): Promise<{ pointValueXof: number; maxRedeemPercent: number }> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'loyalty' } });
    const v = (row?.value as Partial<typeof DEFAULT_LOYALTY_SETTINGS>) ?? {};
    return {
      pointValueXof: v.pointValueXof && v.pointValueXof > 0 ? v.pointValueXof : DEFAULT_LOYALTY_SETTINGS.pointValueXof,
      maxRedeemPercent: v.maxRedeemPercent !== undefined ? Math.min(100, Math.max(0, v.maxRedeemPercent)) : DEFAULT_LOYALTY_SETTINGS.maxRedeemPercent,
    };
  }

  /** Nombre maximum de points utilisables sur un montant, compte tenu du solde et du plafond admin. */
  async maxRedeemablePoints(userId: string, eligibleAmountXof: number, totalAmountXof: number) {
    const [settings, u] = await Promise.all([
      this.getSettings(),
      this.prisma.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true } }),
    ]);
    const balance = u?.loyaltyPoints ?? 0;
    const capXof = Math.min(eligibleAmountXof, Math.floor((totalAmountXof * settings.maxRedeemPercent) / 100));
    const capPoints = Math.floor(capXof / settings.pointValueXof);
    return Math.max(0, Math.min(balance, capPoints));
  }

  /** Crédite des points (gain de participation, correction admin positive, remboursement). */
  async award(userId: string, amount: number, reason: LoyaltyReason, opts: TxOpts = {}) {
    if (amount <= 0) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyTransaction.create({
        data: { userId, amount, reason, registrationId: opts.registrationId, orderId: opts.orderId, note: opts.note },
      });
      await tx.user.update({ where: { id: userId }, data: { loyaltyPoints: { increment: amount } } });
    });
  }

  /**
   * Débite des points (dépense boutique/inscription) — échoue si le solde est insuffisant.
   * Utilisé uniquement pour une dépense volontaire de l'utilisateur : jamais de découvert silencieux.
   */
  async redeem(userId: string, amount: number, reason: LoyaltyReason, opts: TxOpts = {}) {
    if (amount <= 0) return;
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true } });
      if (!u || u.loyaltyPoints < amount) throw new BadRequestException('Solde de points fidélité insuffisant.');
      await tx.loyaltyTransaction.create({
        data: { userId, amount: -amount, reason, registrationId: opts.registrationId, orderId: opts.orderId, note: opts.note },
      });
      await tx.user.update({ where: { id: userId }, data: { loyaltyPoints: { decrement: amount } } });
    });
  }

  /**
   * Retire jusqu'à `amount` points sans jamais échouer ni passer sous zéro — utilisé pour
   * annuler un gain de participation à la désinscription (le solde a pu bouger entre-temps).
   */
  async revokeUpTo(userId: string, amount: number, reason: LoyaltyReason, opts: TxOpts = {}) {
    if (amount <= 0) return;
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true } });
      const toRemove = Math.min(amount, u?.loyaltyPoints ?? 0);
      if (toRemove <= 0) return;
      await tx.loyaltyTransaction.create({
        data: { userId, amount: -toRemove, reason, registrationId: opts.registrationId, orderId: opts.orderId, note: opts.note },
      });
      await tx.user.update({ where: { id: userId }, data: { loyaltyPoints: { decrement: toRemove } } });
    });
  }

  async balance(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true } });
    return u?.loyaltyPoints ?? 0;
  }

  async history(userId: string, take = 100) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
