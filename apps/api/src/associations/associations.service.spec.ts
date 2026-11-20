import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AssociationsService } from './associations.service';
import { slugify } from '../common/slug';

/** Prisma factice : juste ce qu'utilise le service, avec un état en mémoire. */
function setup(opts: { clubStatus?: string; user?: Record<string, unknown> | null; player?: Record<string, unknown> | null } = {}) {
  const club = { id: 'c1', name: 'Gouzepe Gaming Club', slug: 'gouzepe-gaming-club', status: opts.clubStatus ?? 'APPROVED', ownerId: 'owner1' };
  const user = opts.user === undefined ? { id: 'u1', email: 'p@x.tg', displayName: 'Topking', city: null, clubStatus: 'PENDING', clubRequestedId: 'c1' } : opts.user;
  const calls: { playerUpdate?: unknown; playerCreate?: unknown; userUpdate?: unknown; mails: string[] } = { mails: [] };
  const prisma = {
    club: { findUnique: async () => club },
    user: { findUnique: async () => user, update: async (a: unknown) => { calls.userUpdate = a; return {}; } },
    player: {
      findFirst: async () => opts.player ?? null,
      update: async (a: unknown) => { calls.playerUpdate = a; return {}; },
      create: async (a: unknown) => { calls.playerCreate = a; return {}; },
    },
  };
  const mail = { send: async (to: string) => { calls.mails.push(to); }, layout: (t: string, b: string) => `${t}${b}` };
  return { svc: new AssociationsService(prisma as never, mail as never), calls };
}

describe('AssociationsService.reviewMember', () => {
  it('approuve : rattache le joueur au club, débloque le compte et le prévient', async () => {
    const { svc, calls } = setup({ player: { id: 'p1' } });
    await expect(svc.reviewMember('owner1', 'u1', true)).resolves.toEqual({ id: 'u1', status: 'APPROVED' });
    expect(calls.playerUpdate).toEqual({ where: { id: 'p1' }, data: { clubId: 'c1' } });
    expect((calls.userUpdate as { data: Record<string, unknown> }).data).toMatchObject({ clubStatus: 'APPROVED', clubRequested: null, clubRequestedId: null, clubBlocking: false });
    expect(calls.mails).toEqual(['p@x.tg']);
  });

  it("crée la fiche joueur si le compte n'en a pas encore", async () => {
    const { svc, calls } = setup({ player: null });
    await svc.reviewMember('owner1', 'u1', true);
    expect(calls.playerCreate).toEqual({ data: { name: 'Topking', city: null, userId: 'u1', clubId: 'c1' } });
  });

  it('refuse : aucun rattachement, demande effacée', async () => {
    const { svc, calls } = setup({ player: { id: 'p1' } });
    await svc.reviewMember('owner1', 'u1', false);
    expect(calls.playerUpdate).toBeUndefined();
    expect((calls.userUpdate as { data: Record<string, unknown> }).data).toMatchObject({ clubStatus: 'REJECTED', clubRequestedId: null });
  });

  it("une demande visant un AUTRE club n'est pas traitable par cette association", async () => {
    const { svc } = setup({ user: { id: 'u1', email: 'p@x.tg', displayName: 'T', city: null, clubStatus: 'PENDING', clubRequestedId: 'autre-club' } });
    await expect(svc.reviewMember('owner1', 'u1', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('une demande déjà traitée ne se rejoue pas', async () => {
    const { svc } = setup({ user: { id: 'u1', email: 'p@x.tg', displayName: 'T', city: null, clubStatus: 'APPROVED', clubRequestedId: 'c1' } });
    await expect(svc.reviewMember('owner1', 'u1', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("une association pas encore validée par l'équipe ne peut pas valider d'adhésions", async () => {
    const { svc } = setup({ clubStatus: 'PENDING' });
    await expect(svc.reviewMember('owner1', 'u1', true)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('slugify', () => {
  it('retire accents et caractères spéciaux', () => {
    expect(slugify('Gouzepe Gaming Club')).toBe('gouzepe-gaming-club');
    expect(slugify('  Équipe « Éclair » 228 !! ')).toBe('equipe-eclair-228');
    expect(slugify('***')).toBe('club');
  });
});
