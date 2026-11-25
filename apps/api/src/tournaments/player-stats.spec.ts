import { attributeStats } from './player-stats';

const row = (name: string, userId: string | null, points: number, team: string[] | null = null) => ({ name, userId, team, points, wins: 1, matches: 2 });

describe('attributeStats', () => {
  it('les résultats d\'un compte suivent le compte, même après un changement de pseudo', () => {
    const p = { id: 'p1', name: 'NouveauPseudo', userId: 'u1' };
    expect(attributeStats([p], [p], [row('AncienPseudo', 'u1', 8)]).get('p1')).toEqual({ points: 8, wins: 1, matches: 2 });
  });

  it('deux homonymes ne se mélangent pas : le résultat sans compte va à la fiche sans compte', () => {
    const old = { id: 'old', name: 'Topking', userId: null };
    const fresh = { id: 'new', name: 'topking', userId: 'u2' };
    const r = attributeStats([old, fresh], [old, fresh], [row('Topking', null, 5), row('Topking', 'u2', 3)]);
    expect(r.get('old')!.points).toBe(5);
    expect(r.get('new')!.points).toBe(3);
  });

  it('un compte seul à porter son nom reçoit aussi les participations saisies par un organisateur', () => {
    const p = { id: 'p1', name: 'Kofi', userId: 'u1' };
    expect(attributeStats([p], [p], [row('kofi', null, 2), row('Kofi', 'u1', 4)]).get('p1')!.points).toBe(6);
  });

  it('entre deux fiches sans compte du même nom, on n\'attribue rien ; une équipe n\'est jamais comptée', () => {
    const a = { id: 'a', name: 'Ama', userId: null };
    const b = { id: 'b', name: 'Ama', userId: null };
    const r = attributeStats([a, b], [a, b], [row('Ama', null, 9), row('Ama', null, 9, ['x'])]);
    expect([r.get('a')!.points, r.get('b')!.points]).toEqual([0, 0]);
  });
});
