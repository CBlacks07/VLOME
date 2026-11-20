import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

function svc(order: { id: string; status: string } | null) {
  const calls: { deletedPayments?: unknown; deletedOrder?: unknown; update?: unknown } = {};
  const prisma = {
    order: {
      findUnique: async () => order,
      update: async (a: unknown) => { calls.update = a; return { id: order?.id }; },
      delete: (a: unknown) => { calls.deletedOrder = a; return 'delOrder'; },
    },
    onlinePayment: { deleteMany: (a: unknown) => { calls.deletedPayments = a; return 'delPay'; } },
    $transaction: async (ops: unknown[]) => ops,
  };
  const Ctor = AdminService as unknown as new (...a: unknown[]) => AdminService;
  return { service: new Ctor(prisma), calls };
}

describe('AdminService — rangement des commandes', () => {
  it('supprime une commande annulée avec ses tentatives de paiement', async () => {
    const { service, calls } = svc({ id: 'o1', status: 'cancelled' });
    await expect(service.deleteOrder('o1')).resolves.toEqual({ id: 'o1', deleted: true });
    expect(calls.deletedPayments).toEqual({ where: { kind: 'order', refId: 'o1' } });
    expect(calls.deletedOrder).toEqual({ where: { id: 'o1' } });
  });

  it('supprime aussi une commande jamais payée (en attente)', async () => {
    const { service } = svc({ id: 'o2', status: 'pending' });
    await expect(service.deleteOrder('o2')).resolves.toMatchObject({ deleted: true });
  });

  it('refuse de supprimer une commande payée ou livrée (pièce comptable) : il faut l\'archiver', async () => {
    for (const status of ['paid', 'delivered']) {
      const { service, calls } = svc({ id: 'o3', status });
      await expect(service.deleteOrder('o3')).rejects.toBeInstanceOf(ConflictException);
      expect(calls.deletedOrder).toBeUndefined();
    }
  });

  it('commande introuvable', async () => {
    await expect(svc(null).service.deleteOrder('x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc(null).service.setOrderArchived('x', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("archiver ne supprime rien : le drapeau change, c'est tout (même pour une commande payée)", async () => {
    const { service, calls } = svc({ id: 'o4', status: 'paid' });
    await service.setOrderArchived('o4', true);
    expect(calls.update).toEqual({ where: { id: 'o4' }, data: { archived: true } });
    expect(calls.deletedOrder).toBeUndefined();
  });
});
