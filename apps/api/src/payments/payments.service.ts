import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { CreditsService } from '../credits/credits.service';
import type { JwtUser } from '../common/jwt-auth.guard';
import type { CheckoutDto, VerifyDto } from './payments.dto';

type Kind = 'registration' | 'order' | 'credit';
type Provider = 'fedapay';
interface Target { amountXof: number; description: string; userId: string | null }

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tournaments: TournamentsService,
    private readonly credits: CreditsService,
  ) {}

  /* ---------- configuration (clés dans l'environnement, jamais dans le code) ---------- */
  private get fedaKey() { return process.env.FEDAPAY_SECRET_KEY?.trim() || ''; }
  private get fedaBase() { return process.env.FEDAPAY_ENV === 'sandbox' ? 'https://sandbox-api.fedapay.com/v1' : 'https://api.fedapay.com/v1'; }
  /** Plafond par transaction imposé par le compte FedaPay (XOF) — 0 = inconnu. Se relève après vérification (KYC) du compte chez FedaPay. */
  private get fedaMax() { const n = Number(process.env.FEDAPAY_MAX_XOF); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
  private limitMessage(max: number) {
    return `Le paiement en ligne est limité à ${max.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} F par transaction (limite du compte FedaPay). Choisis un autre moyen de paiement, ou règle en plusieurs fois.`;
  }
  private get siteUrl() { return (process.env.SITE_URL?.trim() || 'https://www.miabe-esport.community').replace(/\/$/, ''); }

  /** Origine de retour : celle du navigateur si elle est de confiance (site officiel, localhost, aperçus Vercel), sinon SITE_URL. */
  private returnBase(origin?: string): string {
    if (origin) {
      try {
        const u = new URL(origin);
        const host = u.hostname.replace(/^www\./, '');
        const official = new URL(this.siteUrl).hostname.replace(/^www\./, '');
        const trusted = host === official || u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.vercel.app');
        if (trusted && (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
      } catch { /* origine invalide : repli sur SITE_URL */ }
    }
    return this.siteUrl;
  }

  publicConfig() {
    return {
      fedapay: !!this.fedaKey,
      fedapayMaxXof: this.fedaMax || null,
    };
  }

  /* ---------- élément à payer (montant relu en base) ---------- */
  private async target(kind: Kind, refId: string, user: JwtUser, provider: Provider): Promise<Target> {
    const wanted = provider === 'fedapay' ? 'FedaPay' : '';
    if (kind === 'registration') {
      const reg = await this.prisma.registration.findUnique({ where: { id: refId }, include: { tournament: { select: { name: true } } } });
      if (!reg) throw new NotFoundException('Inscription introuvable.');
      if (reg.userId !== user.sub) throw new ForbiddenException("Cette inscription n'est pas la tienne.");
      if (reg.paymentStatus === 'paid') throw new ConflictException('Cette inscription est déjà payée.');
      if (reg.paymentMethod !== wanted) throw new BadRequestException("Cette inscription n'a pas été créée avec ce moyen de paiement.");
      return { amountXof: reg.amountXof, description: `Inscription ${reg.tournament.name}`, userId: reg.userId };
    }
    if (kind === 'order') {
      const o = await this.prisma.order.findUnique({ where: { id: refId } });
      if (!o) throw new NotFoundException('Commande introuvable.');
      if (o.userId !== user.sub) throw new ForbiddenException("Cette commande n'est pas la tienne.");
      if (o.status !== 'pending') throw new ConflictException("Cette commande n'est plus en attente de paiement.");
      if (o.paymentMethod !== wanted) throw new BadRequestException("Cette commande n'a pas été créée avec ce moyen de paiement.");
      return { amountXof: o.totalXof, description: `Commande ${o.reference}`, userId: o.userId };
    }
    const p = await this.prisma.creditPurchase.findUnique({ where: { id: refId } });
    if (!p) throw new NotFoundException('Achat introuvable.');
    if (p.userId !== user.sub) throw new ForbiddenException("Cet achat n'est pas le tien.");
    if (p.status === 'paid') throw new ConflictException('Cet achat est déjà payé.');
    if (p.paymentMethod !== wanted) throw new BadRequestException("Cet achat n'a pas été créé avec ce moyen de paiement.");
    return { amountXof: p.amountXof, description: `${p.credits} crédit${p.credits > 1 ? 's' : ''} organisateur`, userId: p.userId };
  }

  /**
   * Applique un paiement confirmé par le prestataire. Renvoie { placed: false } quand l'argent est bien encaissé mais que
   * l'inscription n'a pas pu être validée parce que le tournoi a démarré entre-temps : ce n'est PAS une erreur du joueur (il a payé),
   * on ne la jette donc pas — le cas apparaît dans « À traiter » du tableau de bord admin pour un remboursement ou une solution.
   */
  private async finalize(kind: Kind, refId: string): Promise<{ placed: boolean }> {
    if (kind === 'registration') {
      try {
        await this.tournaments.confirmRegistrationPaidOnline(refId);
      } catch (e) {
        if (e instanceof ConflictException) {
          this.log.warn(`Paiement reçu mais inscription ${refId} non placée : ${e.message}`);
          return { placed: false };
        }
        throw e;
      }
    } else if (kind === 'order') await this.prisma.order.updateMany({ where: { id: refId, status: 'pending' }, data: { status: 'paid' } });
    else {
      const p = await this.prisma.creditPurchase.findUnique({ where: { id: refId } });
      if (p && p.status !== 'paid') await this.credits.confirmPurchase(refId);
    }
    return { placed: true };
  }

  /* ---------- démarrage ---------- */
  async checkout(user: JwtUser, dto: CheckoutDto) {
    const target = await this.target(dto.kind, dto.refId, user, dto.provider);
    if (target.amountXof <= 0) throw new BadRequestException('Montant nul : rien à payer en ligne.');

    if (!this.fedaKey) throw new ServiceUnavailableException("FedaPay n'est pas configuré.");
    if (this.fedaMax && target.amountXof > this.fedaMax) throw new BadRequestException(this.limitMessage(this.fedaMax));
    const u = await this.prisma.user.findUnique({ where: { id: user.sub } });
    const callback = `${this.returnBase(dto.returnOrigin)}/?pay=fedapay&kind=${dto.kind}&ref=${encodeURIComponent(dto.refId)}`;
    const created = await this.feda('POST', '/transactions', {
      description: target.description,
      amount: target.amountXof,
      currency: { iso: 'XOF' },
      callback_url: callback,
      customer: { firstname: u?.displayName || 'Client', lastname: 'Miabe', email: u?.email },
    });
    const tx = created['v1/transaction'] ?? created.transaction ?? created;
    const txId = String(tx?.id ?? '');
    if (!txId) throw new ServiceUnavailableException("FedaPay n'a pas créé la transaction.");
    const tok = await this.feda('POST', `/transactions/${txId}/token`, {});
    const url: string | undefined = tok?.url;
    if (!url) throw new ServiceUnavailableException("FedaPay n'a pas fourni de lien de paiement.");
    await this.prisma.onlinePayment.create({
      data: { provider: 'fedapay', kind: dto.kind, refId: dto.refId, userId: user.sub, amountXof: target.amountXof, providerTxId: txId },
    });
    return { provider: 'fedapay', url };
  }

  /* ---------- vérification ---------- */
  async verify(user: JwtUser, dto: VerifyDto) {
    let target: Target | null;
    try {
      target = await this.target(dto.kind, dto.refId, user, dto.provider);
    } catch (e) {
      // Déjà payé (retour navigateur après le webhook, ou rechargement de page) : réponse idempotente.
      if (e instanceof ConflictException) return { paid: true, already: true };
      throw e;
    }
    if (!target) return { paid: true, already: true };

    const pay = await this.prisma.onlinePayment.findFirst({
      where: { provider: dto.provider, kind: dto.kind, refId: dto.refId, userId: user.sub, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!pay) throw new NotFoundException('Aucun paiement en cours pour cet élément.');

    // L'identifiant enregistré à la création fait foi ; celui de l'URL ne peut que le confirmer.
    if (dto.transactionId && pay.providerTxId && dto.transactionId !== pay.providerTxId) throw new BadRequestException('Transaction inattendue.');
    const ok = await this.fedaApproved(pay.providerTxId!, pay.amountXof);
    if (!ok) return { paid: false };
    await this.prisma.onlinePayment.update({ where: { id: pay.id }, data: { status: 'paid' } });
    const fin = await this.finalize(dto.kind, dto.refId);
    return fin.placed ? { paid: true } : { paid: true, placed: false };
  }

  async fedapayWebhook(body: any) {
    const id = String(body?.entity?.id ?? body?.id ?? '');
    if (!id) return { ok: true };
    const pay = await this.prisma.onlinePayment.findUnique({ where: { providerTxId: id } });
    if (!pay || pay.provider !== 'fedapay' || pay.status === 'paid') return { ok: true };
    try {
      const tx = await this.fedaTx(id);
      if (tx.status === 'approved' && tx.amount >= pay.amountXof) {
        await this.prisma.onlinePayment.update({ where: { id: pay.id }, data: { status: 'paid' } });
        await this.finalize(pay.kind as Kind, pay.refId);
      } else if (['declined', 'canceled', 'cancelled', 'refunded', 'expired'].includes(tx.status) && pay.status === 'pending') {
        await this.markFailed(pay);
      }
    } catch (e) {
      this.log.warn(`Webhook FedaPay ${id} : ${(e as Error).message}`);
    }
    return { ok: true };
  }

  /* ---------- appels prestataires ---------- */
  private async feda(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const r = await fetch(this.fedaBase + path, {
      method,
      headers: { Authorization: `Bearer ${this.fedaKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      this.log.warn(`FedaPay ${method} ${path} → ${r.status} ${JSON.stringify(data).slice(0, 300)}`);
      // Refus « métier » de FedaPay (montant au-dessus du plafond du compte, champ invalide…) : on le dit clairement au lieu d'un
      // « momentanément indisponible » trompeur — ce n'est pas une panne, réessayer ne servira à rien.
      if ((r.status === 400 || r.status === 422) && data?.errors && typeof data.errors === 'object') {
        const msgs: string[] = Object.values(data.errors as Record<string, unknown>).flat().map(String);
        const limit = msgs.map((m) => /maximum[^\d]*(\d[\d\s.]*)/i.exec(m)?.[1]).find(Boolean);
        if (limit) throw new BadRequestException(this.limitMessage(Number(limit.replace(/\D/g, ''))));
        throw new BadRequestException(`FedaPay a refusé la transaction : ${msgs.join(' ')}`);
      }
      throw new ServiceUnavailableException('Le paiement en ligne est momentanément indisponible.');
    }
    return data;
  }

  /** Statut et montant d'une transaction chez FedaPay (relus à chaque fois : on ne croit jamais ce que dit le navigateur). */
  private async fedaTx(txId: string): Promise<{ status: string; amount: number }> {
    const d = await this.feda('GET', `/transactions/${txId}`);
    const tx = d['v1/transaction'] ?? d.transaction ?? d;
    return { status: String(tx?.status ?? ''), amount: Number(tx?.amount) };
  }

  private async fedaApproved(txId: string, expectedXof: number): Promise<boolean> {
    const tx = await this.fedaTx(txId);
    return tx.status === 'approved' && tx.amount >= expectedXof;
  }

  /** Un paiement refusé / annulé : la tentative passe en « failed » et, pour une commande, la commande est annulée toute seule. */
  private async markFailed(pay: { id: string; kind: string; refId: string }): Promise<void> {
    await this.prisma.onlinePayment.update({ where: { id: pay.id }, data: { status: 'failed' } });
    if (pay.kind === 'order') await this.prisma.order.updateMany({ where: { id: pay.refId, status: 'pending' }, data: { status: 'cancelled' } });
  }

  /**
   * Remet les statuts d'accord avec la réalité du paiement, sans intervention de l'admin :
   *  - transaction FedaPay approuvée → payée (commande « Payée », inscription validée…) ;
   *  - transaction refusée / annulée → tentative échouée et commande « Annulée » ;
   *  - commande en ligne jamais réglée au bout de 24 h → « Annulée » (paiement abandonné).
   * Appelée au chargement de la liste des commandes et par le webhook ; chaque élément est traité isolément (une erreur n'arrête pas les autres).
   */
  async reconcile(): Promise<{ paid: number; failed: number; expired: number }> {
    const out = { paid: 0, failed: 0, expired: 0 };
    if (this.fedaKey) {
      const pending = await this.prisma.onlinePayment.findMany({
        where: { provider: 'fedapay', status: 'pending', providerTxId: { not: null }, createdAt: { gt: new Date(Date.now() - 3 * 24 * 3600 * 1000) } },
        orderBy: { createdAt: 'desc' }, take: 20,
      });
      await Promise.all(pending.map(async (pay) => {
        try {
          const tx = await this.fedaTx(pay.providerTxId!);
          if (tx.status === 'approved' && tx.amount >= pay.amountXof) {
            await this.prisma.onlinePayment.update({ where: { id: pay.id }, data: { status: 'paid' } });
            await this.finalize(pay.kind as Kind, pay.refId);
            out.paid++;
          } else if (['declined', 'canceled', 'cancelled', 'refunded', 'expired'].includes(tx.status)) {
            await this.markFailed(pay);
            out.failed++;
          }
        } catch (e) { this.log.warn(`Rapprochement ${pay.id} : ${(e as Error).message}`); }
      }));
    }
    const abandoned = await this.prisma.order.findMany({
      where: { status: 'pending', paymentMethod: { in: ['FedaPay', 'KkiaPay'] } /* KkiaPay : anciennes commandes, plus proposé */, createdAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
      select: { id: true }, take: 50,
    });
    for (const o of abandoned) {
      await this.prisma.order.updateMany({ where: { id: o.id, status: 'pending' }, data: { status: 'cancelled' } });
      await this.prisma.onlinePayment.updateMany({ where: { kind: 'order', refId: o.id, status: 'pending' }, data: { status: 'failed' } });
      out.expired++;
    }
    return out;
  }


}
