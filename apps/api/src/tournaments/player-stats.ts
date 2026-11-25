export interface StatRow { userId: string | null; name: string; team: string[] | null; points: number; wins: number; matches: number }
export interface Fiche { id: string; name: string; userId: string | null }
export interface Totals { points: number; wins: number; matches: number }

/**
 * Attribue les résultats (tous jeux confondus) aux fiches de la base de joueurs.
 * - Un résultat rattaché à un compte (le joueur s'est inscrit lui-même) suit ce compte : il survit à un changement de
 *   pseudo et ne se mélange pas avec un homonyme.
 * - Un résultat sans compte (participant saisi par l'organisateur) n'a que son nom : il va à l'unique fiche de ce nom,
 *   ou, entre homonymes, à l'unique fiche sans compte. Si on ne peut pas trancher, il n'est attribué à personne.
 */
export function attributeStats(players: Fiche[], allFiches: Fiche[], rows: StatRow[]): Map<string, Totals> {
  const byUser = new Map<string, Totals>();
  const byName = new Map<string, Totals>();
  const add = (map: Map<string, Totals>, key: string, r: Totals) => {
    const t = map.get(key) ?? { points: 0, wins: 0, matches: 0 };
    map.set(key, { points: Math.round((t.points + r.points) * 10) / 10, wins: t.wins + r.wins, matches: t.matches + r.matches });
  };
  for (const r of rows) {
    if (r.team) continue; // la ligne d'une équipe : ses membres ont déjà la leur
    if (r.userId) add(byUser, r.userId, r);
    else add(byName, r.name.toLowerCase(), r);
  }
  const holders = new Map<string, Fiche[]>();
  for (const f of allFiches) {
    const k = f.name.toLowerCase();
    holders.set(k, [...(holders.get(k) ?? []), f]);
  }
  const heirOf = (name: string): string | undefined => {
    const list = holders.get(name) ?? [];
    if (list.length === 1) return list[0].id;
    const free = list.filter((f) => !f.userId);
    return free.length === 1 ? free[0].id : undefined;
  };
  const out = new Map<string, Totals>();
  for (const p of players) {
    const key = p.name.toLowerCase();
    if (p.userId) { const t = byUser.get(p.userId); if (t) add(out, p.id, t); }
    if (heirOf(key) === p.id) { const t = byName.get(key); if (t) add(out, p.id, t); }
    if (!out.has(p.id)) out.set(p.id, { points: 0, wins: 0, matches: 0 });
  }
  return out;
}
