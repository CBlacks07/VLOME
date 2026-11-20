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
