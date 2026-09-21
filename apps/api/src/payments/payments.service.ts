import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { CreditsService } from '../credits/credits.service';
import type { JwtUser } from '../common/jwt-auth.guard';
import type { CheckoutDto, VerifyDto } from './payments.dto';

type Kind = 'registration' | 'order' | 'credit';
type Provider = 'fedapay' | 'kkiapay';
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
  private get kkiaPublic() { return process.env.KKIAPAY_PUBLIC_KEY?.trim() || ''; }
  private get kkiaPrivate() { return process.env.KKIAPAY_PRIVATE_KEY?.trim() || ''; }
  private get kkiaSecret() { return process.env.KKIAPAY_SECRET_KEY?.trim() || ''; }
  private get kkiaSandbox() { return process.env.KKIAPAY_SANDBOX === 'true'; }
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
      kkiapay: this.kkiaPublic && this.kkiaSecret ? { publicKey: this.kkiaPublic, sandbox: this.kkiaSandbox } : null,
    };
  }

  /* ---------- élément à payer (montant relu en base) ---------- */
  private async target(kind: Kind, refId: string, user: JwtUser, provider: Provider): Promise<Target> {
    const wanted = provider === 'fedapay' ? 'FedaPay' : 'KkiaPay';
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

  private async finalize(kind: Kind, refId: string) {
    if (kind === 'registration') await this.tournaments.confirmRegistrationPaidOnline(refId);
    else if (kind === 'order') await this.prisma.order.updateMany({ where: { id: refId, status: 'pending' }, data: { status: 'paid' } });
    else {
      const p = await this.prisma.creditPurchase.findUnique({ where: { id: refId } });
      if (p && p.status !== 'paid') await this.credits.confirmPurchase(refId);
    }
  }

  /* ---------- démarrage ---------- */
  async checkout(user: JwtUser, dto: CheckoutDto) {
    const target = await this.target(dto.kind, dto.refId, user, dto.provider);
    if (target.amountXof <= 0) throw new BadRequestException('Montant nul : rien à payer en ligne.');

    if (dto.provider === 'kkiapay') {
      if (!(this.kkiaPublic && this.kkiaSecret)) throw new ServiceUnavailableException("KkiaPay n'est pas configuré.");
      const pay = await this.prisma.onlinePayment.create({
        data: { provider: 'kkiapay', kind: dto.kind, refId: dto.refId, userId: user.sub, amountXof: target.amountXof },
      });
      // Widget côté navigateur : pas de redirection, la transaction est vérifiée au retour du widget (verify).
      return { provider: 'kkiapay', paymentId: pay.id, amountXof: target.amountXof, publicKey: this.kkiaPublic, sandbox: this.kkiaSandbox, description: target.description };
    }

    if (!this.fedaKey) throw new ServiceUnavailableException("FedaPay n'est pas configuré.");
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

    let pay = await this.prisma.onlinePayment.findFirst({
      where: { provider: dto.provider, kind: dto.kind, refId: dto.refId, userId: user.sub, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!pay) throw new NotFoundException('Aucun paiement en cours pour cet élément.');

    let ok = false;
    if (dto.provider === 'fedapay') {
      // L'identifiant enregistré à la création fait foi ; celui de l'URL ne peut que le confirmer.
      if (dto.transactionId && pay.providerTxId && dto.transactionId !== pay.providerTxId) throw new BadRequestException('Transaction inattendue.');
      ok = await this.fedaApproved(pay.providerTxId!, pay.amountXof);
    } else {
      if (!dto.transactionId) throw new BadRequestException('Identifiant de transaction manquant.');
      const used = await this.prisma.onlinePayment.findUnique({ where: { providerTxId: dto.transactionId } });
      if (used && used.id !== pay.id) throw new ConflictException('Cette transaction a déjà servi.');
      ok = await this.kkiaSuccess(dto.transactionId, pay.amountXof);
      if (ok) pay = await this.prisma.onlinePayment.update({ where: { id: pay.id }, data: { providerTxId: dto.transactionId } });
    }
    if (!ok) return { paid: false };
    await this.prisma.onlinePayment.update({ where: { id: pay.id }, data: { status: 'paid' } });
    await this.finalize(dto.kind, dto.refId);
    return { paid: true };
  }

  async fedapayWebhook(body: any) {
    const id = String(body?.entity?.id ?? body?.id ?? '');
    if (!id) return { ok: true };
    const pay = await this.prisma.onlinePayment.findUnique({ where: { providerTxId: id } });
    if (!pay || pay.provider !== 'fedapay' || pay.status === 'paid') return { ok: true };
    try {
      if (await this.fedaApproved(id, pay.amountXof)) {
        await this.prisma.onlinePayment.update({ where: { id: pay.id }, data: { status: 'paid' } });
        await this.finalize(pay.kind as Kind, pay.refId);
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
      throw new ServiceUnavailableException('Le paiement en ligne est momentanément indisponible.');
    }
    return data;
  }

  private async fedaApproved(txId: string, expectedXof: number): Promise<boolean> {
    const d = await this.feda('GET', `/transactions/${txId}`);
    const tx = d['v1/transaction'] ?? d.transaction ?? d;
    return tx?.status === 'approved' && Number(tx?.amount) >= expectedXof;
  }

  private async kkiaSuccess(txId: string, expectedXof: number): Promise<boolean> {
    const base = this.kkiaSandbox ? 'https://api-sandbox.kkiapay.me' : 'https://api.kkiapay.me';
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': this.kkiaPublic, 'x-secret-key': this.kkiaSecret };
    if (this.kkiaPrivate) headers['x-private-key'] = this.kkiaPrivate;
    const r = await fetch(`${base}/api/v1/transactions/status`, { method: 'POST', headers, body: JSON.stringify({ transactionId: txId }) });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      this.log.warn(`KkiaPay status ${txId} → ${r.status} ${JSON.stringify(d).slice(0, 300)}`);
      return false;
    }
    return d?.status === 'SUCCESS' && Number(d?.amount) >= expectedXof;
  }
}
