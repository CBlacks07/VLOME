import { dayKeys, fillSeries, mergeActivity, liveSummary, recentResults, toUnplaced, DAY_MS, type ActivityItem } from './dashboard.service';

describe('dashboard — fonctions pures', () => {
  it('dayKeys : 14 jours, du plus ancien au plus récent, aujourd\'hui en dernier (UTC)', () => {
    const keys = dayKeys(new Date('2026-11-20T23:59:59Z'));
    expect(keys).toHaveLength(14);
    expect(keys[13]).toBe('2026-11-20');
    expect(keys[0]).toBe('2026-11-07');
    expect(dayKeys(new Date('2026-03-01T00:00:00Z'), 3)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('fillSeries : aligne sur les jours, 0 pour un jour sans événement, ignore ce qui est hors fenêtre', () => {
    const keys = ['2026-11-18', '2026-11-19', '2026-11-20'];
    const rows = [{ d: '2026-11-18', n: 2, amt: 500 }, { d: '2026-11-20', n: 5, amt: 0 }, { d: '2020-01-01', n: 99, amt: 99 }];
    expect(fillSeries(keys, rows, 'n')).toEqual([2, 0, 5]);
    expect(fillSeries(keys, rows, 'amt')).toEqual([500, 0, 0]);
  });

  it('mergeActivity : plus récent d\'abord, limité, sans date invalide', () => {
    const mk = (ts: number, title: string): ActivityItem => ({ type: 'user', ts, title, tone: 'info' });
    const out = mergeActivity([[mk(1, 'a'), mk(5, 'e')], [mk(3, 'c'), mk(NaN, 'x')], [mk(4, 'd')]], 3);
    expect(out.map((a) => a.title)).toEqual(['e', 'd', 'c']);
  });

  const engine = {
    players: [{ id: 'p1', name: 'Kofi' }, { id: 'p2', name: 'Ama' }, { id: 'p3', name: 'Sena' }],
    finals: {},
    log: [
      { stage: 'survival', a: 'p1', b: 'p2', winner: 'p1', ts: 1000 },
      { stage: 'finals', a: 'p2', b: 'p3', winner: 'p3', ts: 5000 },
      { stage: 'championBonus', a: 'p3', b: null, winner: 'p3', ts: 9000 },
      { stage: 'streakBonus', a: 'p1', b: null, winner: 'p1', ts: 9500 },
    ],
  };

  it('liveSummary : joueurs, matchs réellement joués (bonus exclus), dernière activité, phase', () => {
    const s = liveSummary({ id: 't1', name: 'Cup', game: null, format: 'SURVIVAL', engineState: engine });
    expect(s).toMatchObject({ id: 't1', players: 3, played: 2, lastTs: 5000, phase: 'finals', game: '' });
    expect(liveSummary({ id: 't2', name: 'Vide', game: 'EA FC', format: 'DOUBLE_ELIM', engineState: null })).toMatchObject({ players: 0, played: 0, lastTs: null, phase: 'pools' });
  });

  it('recentResults : « X bat Y », seulement les matchs récents et réels', () => {
    const out = recentResults({ name: 'Cup', engineState: engine }, 2000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'result', ts: 5000, title: 'Sena bat Ama', detail: 'Cup' });
    expect(recentResults({ name: 'Cup', engineState: engine }, 0)).toHaveLength(2);
    expect(recentResults({ name: 'Cup', engineState: null }, 0)).toEqual([]);
  });

  it('DAY_MS vaut 24 h', () => { expect(DAY_MS).toBe(24 * 3600 * 1000); });

  it("toUnplaced : seuls les paiements encaissés dont l’inscription est restée en attente, tournoi démarré signalé", () => {
    const payments = [
      { refId: 'r1', amountXof: 2000, createdAt: new Date('2026-11-20T10:00:00Z') },
      { refId: 'r2', amountXof: 5000, createdAt: new Date('2026-11-21T09:00:00Z') },
      { refId: 'r9', amountXof: 1000, createdAt: new Date('2026-11-22T09:00:00Z') }, // inscription introuvable : ignorée
    ];
    const regs = [
      { id: 'r1', playerName: 'Kofi', tournamentId: 't1', tournament: { name: 'Cup A', status: 'LIVE' } },
      { id: 'r2', playerName: 'Ama', tournamentId: 't2', tournament: { name: 'Cup B', status: 'DRAFT' } },
      { id: 'r3', playerName: 'Sena', tournamentId: 't2', tournament: { name: 'Cup B', status: 'DRAFT' } }, // jamais payée en ligne : ignorée
    ];
    const out = toUnplaced(payments, regs);
    expect(out.map((o) => o.playerName)).toEqual(['Ama', 'Kofi']); // plus récent d'abord
    expect(out.find((o) => o.playerName === 'Kofi')).toMatchObject({ tournamentStarted: true, amountXof: 2000, tournamentName: 'Cup A' });
    expect(out.find((o) => o.playerName === 'Ama')).toMatchObject({ tournamentStarted: false, amountXof: 5000 });
    expect(toUnplaced([], [])).toEqual([]);
  });
});
