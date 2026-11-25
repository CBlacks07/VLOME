import { AssociationsService } from './associations.service';
import { slugify } from '../common/slug';

describe('slugify', () => {
  it('retire accents et caractères spéciaux', () => {
    expect(slugify('Gouzepe Gaming Club')).toBe('gouzepe-gaming-club');
    expect(slugify('  Équipe « Éclair » 228 !! ')).toBe('equipe-eclair-228');
    expect(slugify('***')).toBe('club');
  });
});

describe('AssociationsService.attachOwner', () => {
  function build(over: { club?: Record<string, unknown> | null; user?: Record<string, unknown> | null } = {}) {
    const calls: { created?: Record<string, unknown>; clubUpdate?: Record<string, unknown>; mails: number } = { mails: 0 };
    const prisma = {
      club: {
        findUnique: async () => (over.club === undefined ? { id: 'c1', name: 'Gouzepe', city: 'Lomé', ownerId: null, contactEmail: null } : over.club),
        update: async (a: { data: Record<string, unknown> }) => { calls.clubUpdate = a.data; return {}; },
      },
      user: {
        findUnique: async () => (over.user === undefined ? null : over.user),
        create: async (a: { data: Record<string, unknown> }) => { calls.created = a.data; return { id: 'newU' }; },
      },
    };
    const mail = { send: async () => { calls.mails++; return true; }, layout: (t: string, b: string) => t + b, siteUrl: 'https://x' };
    return { svc: new AssociationsService(prisma as never, mail as never, { playerStats: async () => new Map() } as never, { notifyWaitingPlayers: async () => {} } as never), calls };
  }

  it('crée un compte ASSOCIATION avec mot de passe temporaire haché et le rattache au club', async () => {
    const { svc, calls } = build();
    const r = await svc.attachOwner('c1', ' Contact@Gouzepe-Gaming.com ');
    expect(r).toMatchObject({ email: 'contact@gouzepe-gaming.com', created: true, emailed: true });
    expect(r.password && r.password.length >= 10).toBe(true);
    expect(calls.created).toMatchObject({ role: 'ASSOCIATION', email: 'contact@gouzepe-gaming.com' });
    expect(calls.created!.passwordHash).not.toBe(r.password);
    expect(calls.clubUpdate).toMatchObject({ ownerId: 'newU', contactEmail: 'contact@gouzepe-gaming.com' });
  });

  it("refuse une adresse déjà utilisée par un compte joueur (on ne retire les droits de personne)", async () => {
    const { svc } = build({ user: { id: 'u9', role: 'PLAYER', ownedClub: null } });
    await expect(svc.attachOwner('c1', 'p@x.tg')).rejects.toThrow(/déjà utilisée/);
  });

  it('rattache un compte admin existant sans toucher à son rôle ni à son mot de passe', async () => {
    const { svc, calls } = build({ user: { id: 'adm', role: 'ADMIN', ownedClub: null } });
    const r = await svc.attachOwner('c1', 'admin@x.tg');
    expect(r).toMatchObject({ created: false, password: null });
    expect(calls.created).toBeUndefined();
    expect(calls.clubUpdate).toMatchObject({ ownerId: 'adm' });
  });

  it('refuse un compte qui gère déjà un autre club', async () => {
    const { svc } = build({ user: { id: 'adm', role: 'ADMIN', ownedClub: { name: 'Autre' } } });
    await expect(svc.attachOwner('c1', 'admin@x.tg')).rejects.toThrow(/gère déjà le club/);
  });

  it('refuse un club qui a déjà une association', async () => {
    const { svc } = build({ club: { id: 'c1', name: 'G', ownerId: 'someone' } });
    await expect(svc.attachOwner('c1', 'a@b.tg')).rejects.toThrow(/déjà un compte/);
  });
});
