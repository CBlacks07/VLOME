import { computeElo, expectedScore, ELO_START } from './elo';

describe('computeElo', () => {
  it('deux joueurs égaux : le vainqueur gagne 16, le perdant perd 16 (K = 32)', () => {
    const r = computeElo([{ ts: 1, a: 'A', b: 'B', winner: 'a' }]);
    expect(Math.round(r.get('A')!)).toBe(ELO_START + 16);
    expect(Math.round(r.get('B')!)).toBe(ELO_START - 16);
  });

  it("c'est un jeu à somme nulle : ce que l'un gagne, l'autre le perd", () => {
    const r = computeElo([
      { ts: 1, a: 'A', b: 'B', winner: 'a' }, { ts: 2, a: 'B', b: 'C', winner: 'a' },
      { ts: 3, a: 'A', b: 'C', winner: 'b' }, { ts: 4, a: 'C', b: 'A', winner: 'a' },
    ]);
    const total = [...r.values()].reduce((x, y) => x + y, 0);
    expect(Math.round(total)).toBe(ELO_START * r.size);
  });

  it("battre un joueur mieux classé rapporte plus que battre un joueur plus faible", () => {
    // A monte d'abord (2 victoires de suite), puis C (1000) bat A (mieux classé) vs C bat D (1000 aussi)
    const base = computeElo([{ ts: 1, a: 'A', b: 'X', winner: 'a' }, { ts: 2, a: 'A', b: 'Y', winner: 'a' }]);
    const before = base.get('A')!;
    expect(before).toBeGreaterThan(ELO_START);
    const upset = computeElo([{ ts: 1, a: 'A', b: 'X', winner: 'a' }, { ts: 2, a: 'A', b: 'Y', winner: 'a' }, { ts: 3, a: 'A', b: 'C', winner: 'b' }]);
    const gainUpset = upset.get('C')! - ELO_START;
    const even = computeElo([{ ts: 1, a: 'C', b: 'D', winner: 'a' }]);
    expect(gainUpset).toBeGreaterThan(even.get('C')! - ELO_START);
  });

  it("l'ordre chronologique compte, pas l'ordre du tableau", () => {
    const m = [{ ts: 2, a: 'B', b: 'A', winner: 'a' as const }, { ts: 1, a: 'A', b: 'B', winner: 'a' as const }];
    const r1 = computeElo(m);
    const r2 = computeElo([...m].reverse());
    expect(r1.get('A')).toBeCloseTo(r2.get('A')!, 6);
  });

  it('un match nul entre égaux ne change rien ; contre mieux classé, il rapporte des points', () => {
    const even = computeElo([{ ts: 1, a: 'A', b: 'B', winner: 'draw' }]);
    expect(Math.round(even.get('A')!)).toBe(ELO_START);
    const r = computeElo([{ ts: 1, a: 'A', b: 'X', winner: 'a' }, { ts: 2, a: 'A', b: 'B', winner: 'draw' }]);
    expect(r.get('B')!).toBeGreaterThan(ELO_START);
  });

  it('ignore un match d\'un concurrent contre lui-même', () => {
    expect(computeElo([{ ts: 1, a: 'A', b: 'A', winner: 'a' }]).size).toBe(0);
  });

  it('probabilité attendue : 50 % à égalité, 64 % avec 100 points d\'avance', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
    expect(expectedScore(1100, 1000)).toBeCloseTo(0.64, 2);
  });
});
