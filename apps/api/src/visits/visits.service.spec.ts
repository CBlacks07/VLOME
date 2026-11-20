import { VisitsService } from './visits.service';

/** PrismaService minimal : on ne teste ici que la logique du service (filtre des robots, numéro renvoyé). */
function makeService(count: number | null) {
  const calls = { raw: 0 };
  const prisma = {
    setting: { findUnique: jest.fn().mockResolvedValue(count === null ? null : { key: 'visitors', value: { count } }) },
    $queryRaw: jest.fn().mockImplementation(async () => { calls.raw++; return [{ n: (count ?? 0) + 1 }]; }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new VisitsService(prisma as any), prisma, calls };
}

describe('VisitsService', () => {
  const browser = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';

  it('un navigateur reçoit le numéro suivant', async () => {
    const { svc, calls } = makeService(41);
    expect(await svc.register(browser)).toEqual({ number: 42, total: 42 });
    expect(calls.raw).toBe(1);
  });

  it('le tout premier visiteur est le n° 1', async () => {
    const { svc } = makeService(null);
    expect((await svc.register(browser)).number).toBe(1);
  });

  it.each([
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'facebookexternalhit/1.1',
    'WhatsApp/2.23.1 A',
    'curl/8.4.0',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'HeadlessChrome/120',
  ])('un robot ou un aperçu de lien n\'est pas compté : %s', async (ua) => {
    const { svc, calls } = makeService(10);
    const r = await svc.register(ua);
    expect(r).toEqual({ number: null, total: 10 });
    expect(calls.raw).toBe(0);
  });

  it('sans User-Agent, rien n\'est compté', async () => {
    const { svc, calls } = makeService(10);
    expect((await svc.register(undefined)).number).toBeNull();
    expect(calls.raw).toBe(0);
  });

  it('total() vaut 0 tant que personne n\'est passé, et ignore une valeur invalide', async () => {
    expect(await makeService(null).svc.total()).toBe(0);
    expect(await makeService(-5).svc.total()).toBe(0);
    expect(await makeService(7).svc.total()).toBe(7);
  });
});

describe('VisitsService — présence et jours', () => {
  const browser = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
  function svcWith(presence: Record<string, number> | null, days: Record<string, number> | null) {
    const prisma = {
      setting: { findUnique: jest.fn().mockImplementation(async ({ where }: { where: { key: string } }) => {
        if (where.key === 'presence') return presence ? { key: 'presence', value: presence } : null;
        return days ? { key: 'visitors', value: { count: 3, days } } : null;
      }) },
      $queryRaw: jest.fn().mockResolvedValue([{ online: 4 }]),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { svc: new VisitsService(prisma as any), prisma };
  }

  it('online() ne compte que les signes de vie récents', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { svc } = svcWith({ a: now - 10, b: now - 100, c: now - 400, d: now - 99999 }, null);
    expect(await svc.online()).toBe(2);
    expect(await svcWith(null, null).svc.online()).toBe(0);
  });

  it('days() renvoie le détail par jour, ou {} sans données', async () => {
    expect(await svcWith(null, { '2026-11-20': 7 }).svc.days()).toEqual({ '2026-11-20': 7 });
    expect(await svcWith(null, null).svc.days()).toEqual({});
  });

  it('ping() : identifiant invalide, robot ou sans User-Agent => rien n\'est écrit', async () => {
    const { svc, prisma } = svcWith({}, null);
    await svc.ping('x', browser);                 // trop court
    await svc.ping('bad id with spaces!!', browser);
    await svc.ping('abcdefgh1234', 'Googlebot/2.1');
    await svc.ping('abcdefgh1234', undefined);
    await svc.ping(undefined, browser);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('ping() : un identifiant valide enregistre la présence et renvoie le nombre en ligne', async () => {
    const { svc, prisma } = svcWith({}, null);
    expect(await svc.ping('abcdefgh1234', browser)).toEqual({ online: 4 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
