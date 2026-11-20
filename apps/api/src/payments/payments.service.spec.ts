import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/** Seul `finalize` est testé ici : ce que devient une inscription quand le prestataire a bien encaissé. */
function make(confirm: jest.Mock) {
  const prisma = { order: { updateMany: jest.fn() }, creditPurchase: { findUnique: jest.fn() } };
  const tournaments = { confirmRegistrationPaidOnline: confirm };
  const credits = { confirmPurchase: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new PaymentsService(prisma as any, tournaments as any, credits as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { finalize: (kind: string, id: string) => (svc as any).finalize(kind, id) as Promise<{ placed: boolean }>, prisma, credits };
}

describe('PaymentsService.finalize', () => {
  it('inscription validée : placed = true', async () => {
    const confirm = jest.fn().mockResolvedValue({ confirmed: true });
    expect(await make(confirm).finalize('registration', 'r1')).toEqual({ placed: true });
    expect(confirm).toHaveBeenCalledWith('r1');
  });

  it('tournoi déjà démarré : le paiement est reçu, on ne jette PAS d\'erreur, placed = false', async () => {
    const confirm = jest.fn().mockRejectedValue(new ConflictException('Le tournoi a déjà démarré.'));
    expect(await make(confirm).finalize('registration', 'r1')).toEqual({ placed: false });
  });

  it('une autre erreur (inscription introuvable…) est toujours remontée', async () => {
    const confirm = jest.fn().mockRejectedValue(new NotFoundException('Inscription introuvable.'));
    await expect(make(confirm).finalize('registration', 'r1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('commande : passe en payée, placed = true', async () => {
    const m = make(jest.fn());
    expect(await m.finalize('order', 'o1')).toEqual({ placed: true });
    expect(m.prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'pending' }, data: { status: 'paid' } });
  });
});

/** Rapprochement automatique des statuts avec la réalité du paiement + message clair quand FedaPay refuse le montant. */
describe('PaymentsService — plafond FedaPay et statuts automatiques', () => {
  const saved = { key: process.env.FEDAPAY_SECRET_KEY, max: process.env.FEDAPAY_MAX_XOF };
  beforeEach(() => { process.env.FEDAPAY_SECRET_KEY = 'sk_test'; delete process.env.FEDAPAY_MAX_XOF; });
  afterEach(() => { process.env.FEDAPAY_SECRET_KEY = saved.key; if (saved.max === undefined) delete process.env.FEDAPAY_MAX_XOF; else process.env.FEDAPAY_MAX_XOF = saved.max; jest.restoreAllMocks(); });

  function build(prismaOver: Record<string, unknown> = {}) {
    const prisma = {
      order: { updateMany: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      onlinePayment: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({}) },
      creditPurchase: { findUnique: jest.fn() },
      ...prismaOver,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new PaymentsService(prisma as any, { confirmRegistrationPaidOnline: jest.fn() } as any, { confirmPurchase: jest.fn() } as any);
    return { svc, prisma };
  }
  const fedaReply = (status: string, amount = 50000) => new Response(JSON.stringify({ 'v1/transaction': { id: 1, status, amount } }), { status: 200 });

  it('FedaPay refuse un montant trop élevé : message clair et neutre pour le client, sans détail interne', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ message: 'La création de la transaction a échoué', errors: { amount: ['Le montant maximum de transactions autorisées est 20000.'] } }), { status: 400 }));
    const { svc } = build();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((svc as any).feda('POST', '/transactions', {})).rejects.toThrow(/ne peut pas être réglé en ligne/);
  });

  it('plafond connu (FEDAPAY_MAX_XOF) : exposé à la config publique', () => {
    process.env.FEDAPAY_MAX_XOF = '20000';
    expect(build().svc.publicConfig()).toMatchObject({ fedapay: true, fedapayMaxXof: 20000 });
  });

  it('transaction refusée/annulée : tentative échouée ET commande annulée automatiquement', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => fedaReply('declined'));
    const { svc, prisma } = build();
    prisma.onlinePayment.findMany.mockResolvedValue([{ id: 'p1', kind: 'order', refId: 'o1', providerTxId: '1', amountXof: 50000 }]);
    expect(await svc.reconcile()).toMatchObject({ failed: 1, paid: 0 });
    expect(prisma.onlinePayment.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'failed' } });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'pending' }, data: { status: 'cancelled' } });
  });

  it('transaction approuvée : commande passée en payée automatiquement', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => fedaReply('approved'));
    const { svc, prisma } = build();
    prisma.onlinePayment.findMany.mockResolvedValue([{ id: 'p1', kind: 'order', refId: 'o1', providerTxId: '1', amountXof: 50000 }]);
    expect(await svc.reconcile()).toMatchObject({ paid: 1, failed: 0 });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'pending' }, data: { status: 'paid' } });
  });

  it('transaction encore en attente chez FedaPay : on ne touche à rien', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => fedaReply('pending'));
    const { svc, prisma } = build();
    prisma.onlinePayment.findMany.mockResolvedValue([{ id: 'p1', kind: 'order', refId: 'o1', providerTxId: '1', amountXof: 50000 }]);
    expect(await svc.reconcile()).toMatchObject({ paid: 0, failed: 0 });
    expect(prisma.onlinePayment.update).not.toHaveBeenCalled();
  });

  it('commande en ligne jamais réglée depuis plus de 24 h : annulée (paiement abandonné)', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async () => fedaReply('pending'));
    const { svc, prisma } = build();
    prisma.order.findMany.mockResolvedValue([{ id: 'o9' }]);
    expect(await svc.reconcile()).toMatchObject({ expired: 1 });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o9', status: 'pending' }, data: { status: 'cancelled' } });
  });
});
