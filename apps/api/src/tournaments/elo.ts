/**
 * Classement ELO calculé à partir des matchs réellement joués (jamais saisi à la main, jamais une valeur par défaut affichée comme un niveau).
 *
 * Principe classique : chaque joueur démarre à 1000 ; à chaque duel, le vainqueur gagne des points et le perdant en perd autant, d'autant plus
 * que le résultat était inattendu (battre plus fort que soi rapporte beaucoup, battre plus faible presque rien).
 * Les matchs sont rejoués dans l'ordre chronologique, tournoi après tournoi. L'ELO d'un jeu n'a rien à voir avec celui d'un autre : le
 * calcul est fait séparément pour chaque jeu (voir TournamentsService.computeLeaderboard).
 */
export const ELO_START = 1000;
export const ELO_K = 32;

export interface EloMatch {
  ts: number;
  /** Clés des deux concurrents (une clé = un joueur, ou une équipe). */
  a: string;
  b: string;
  winner: 'a' | 'b';
}

/** Probabilité de victoire de A contre B d'après leurs ELO. */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** Rejoue les matchs dans l'ordre et renvoie l'ELO final de chaque concurrent (non arrondi). */
export function computeElo(matches: EloMatch[]): Map<string, number> {
  const rating = new Map<string, number>();
  const get = (k: string) => rating.get(k) ?? ELO_START;
  for (const m of [...matches].sort((x, y) => x.ts - y.ts)) {
    if (!m.a || !m.b || m.a === m.b) continue;
    const ra = get(m.a), rb = get(m.b);
    const ea = expectedScore(ra, rb);
    const sa = m.winner === 'a' ? 1 : 0;
    rating.set(m.a, ra + ELO_K * (sa - ea));
    rating.set(m.b, rb + ELO_K * ((1 - sa) - (1 - ea)));
  }
  return rating;
}
