import { AdminService } from './admin.service';

/** Un compte qui pilote une association ne doit jamais perdre ce rôle par un clic dans la liste des utilisateurs. */
function svc(ownedClub: { name: string } | null) {
  let updated: unknown = null;
  const prisma = {
    user: {
      findUnique: async () => ({ ownedClub }),
      update: async (a: unknown) => { updated = a; return { id: 'u1' }; },
    },
  };
  const AdminCtor = AdminService as unknown as new (...a: unknown[]) => AdminService;
  return { service: new AdminCtor(prisma), updated: () => updated };
}

describe('AdminService.setRole', () => {
  it("refuse de changer le rôle d'un compte qui pilote une association", async () => {
    const { service, updated } = svc({ name: 'Gouzepe Gaming Club' });
    await expect(service.setRole('u1', 'PLAYER')).rejects.toThrow(/pilote l'association/);
    expect(updated()).toBeNull();
  });

  it('laisse un responsable de club devenir admin', async () => {
    const { service, updated } = svc({ name: 'Gouzepe Gaming Club' });
    await service.setRole('u1', 'ADMIN');
    expect(updated()).toMatchObject({ data: { role: 'ADMIN' } });
  });

  it('permet de rétablir le rôle association d\'un compte propriétaire', async () => {
    const { service, updated } = svc({ name: 'Gouzepe Gaming Club' });
    await service.setRole('u1', 'ASSOCIATION');
    expect(updated()).toMatchObject({ data: { role: 'ASSOCIATION' } });
  });

  it("n'accorde pas le rôle association à un compte sans club", async () => {
    const { service } = svc(null);
    await expect(service.setRole('u1', 'ASSOCIATION')).rejects.toThrow(/Aucune association/);
  });

  it('change normalement le rôle des autres comptes', async () => {
    const { service, updated } = svc(null);
    await service.setRole('u1', 'ORGANIZER');
    expect(updated()).toMatchObject({ data: { role: 'ORGANIZER' } });
  });
});
