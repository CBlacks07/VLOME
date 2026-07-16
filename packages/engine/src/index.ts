/* =========================================================
   @vlome/engine — Moteur de tournoi Survival Challonge (TS)
   Logique pure, sans dépendance : réutilisable web + API.
   Portage TypeScript du moteur éprouvé de Survival Challonge.
   ========================================================= */

export interface Player { id: string; name: string; club: string; }

export interface Scoring {
  survWin: number;      // victoire en poule Survival
  loserWin: number;     // victoire en poule des perdants (repêchage)
  poolFinalWin: number; // victoire en finale de poule
  finalsWin: number;    // victoire en phase finale
  championBonus: number;// bonus champion du tournoi
}

export interface BracketMatch { id: string; a: string | null; b: string | null; winner: string | null; bye: boolean; }
export interface Bracket { rounds: BracketMatch[][]; }

export type PoolPhase = 'pending' | 'survival' | 'losers' | 'poolFinal' | 'done';

export interface Pool {
  id: string; name: string;
  playerIds: string[]; order: string[];
  phase: PoolPhase;
  wSurvivor: string | null; wIndex: number; wLosers: string[]; wChampion: string | null;
  wStreak: number; wBestStreak: Record<string, number>;
  lBracket: Bracket | null; lChampion: string | null;
  top1: string | null; top2: string | null;
}

export type Stage = 'survival' | 'losers' | 'poolFinal' | 'finals' | 'championBonus' | 'adjust';

export interface LogEntry {
  id: string; poolId: string; stage: Stage;
  a: string | null; b: string | null; winner: string;
  pts: number; ts: number; reason?: string;
  sa?: number; sb?: number; // scores FT du match (côté a / côté b)
}

export type Status = 'setup' | 'live' | 'finished';

export interface Tournament {
  id: string; createdAt: number; finishedAt?: number;
  name: string; game: string; date: string; place: string;
  pointsPerPlayer: number; nbPools: number;
  players: Player[];
  scoring: Scoring;
  pools: Pool[];
  status: Status;
  log: LogEntry[];
  points: Record<string, number>;
  finals: Bracket | null;
  champion: string | null;
}

const POOL_NAMES = 'ABCDEFGHIJKL'.split('');

export function uid(): string {
  return 'id' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Création ---------- */

export function newTournament(cfg: Partial<Tournament> = {}): Tournament {
  return {
    id: uid(), createdAt: Date.now(),
    name: cfg.name || 'Tournoi sans nom',
    game: cfg.game || '', date: cfg.date || '', place: cfg.place || '',
    pointsPerPlayer: cfg.pointsPerPlayer || 5,
    nbPools: cfg.nbPools || 2,
    players: [],
    scoring: cfg.scoring || { survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3 },
    pools: [], status: 'setup', log: [], points: {}, finals: null, champion: null,
  };
}

export function parseEntry(raw: string): { name: string; club: string } {
  let name = String(raw).trim(), club = '';
  const at = name.lastIndexOf('@');
  if (at > 0) { club = name.slice(at + 1).trim(); name = name.slice(0, at).trim(); }
  return { name, club };
}

export function setPlayers(t: Tournament, names: string[]): void {
  const seen: Record<string, boolean> = {};
  t.players = [];
  names.forEach(raw => {
    const { name, club } = parseEntry(raw);
    if (!name) return;
    const k = name.toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    t.players.push({ id: uid(), name, club });
  });
}

export function playerName(t: Tournament, id: string | null): string {
  const p = t.players.find(x => x.id === id);
  return p ? p.name : '?';
}

/* ---------- Barème (déplafonné) ---------- */

export function scoringBounds(key: keyof Scoring): { min: number; max: number } {
  return key === 'championBonus' ? { min: 0, max: 999 } : { min: 0.25, max: 999 };
}

/* ---------- Poules ---------- */

export function balancedSizes(nPlayers: number, nbPools: number): number[] {
  const nb = Math.max(1, Math.min(nbPools, Math.max(nPlayers, 1)));
  const base = Math.floor(nPlayers / nb), extra = nPlayers % nb;
  return Array.from({ length: nb }, (_, i) => base + (i < extra ? 1 : 0));
}

export function distributePools(t: Tournament): void {
  const nb = Math.max(1, Math.min(t.nbPools, t.players.length));
  const mixed = shuffle(t.players.map(p => p.id));
  const pools: Pool[] = [];
  for (let i = 0; i < nb; i++) {
    pools.push({
      id: uid(), name: 'Poule ' + POOL_NAMES[i], playerIds: [], order: [], phase: 'pending',
      wSurvivor: null, wIndex: 0, wLosers: [], wChampion: null, wStreak: 0, wBestStreak: {},
      lBracket: null, lChampion: null, top1: null, top2: null,
    });
  }
  mixed.forEach((pid, i) => pools[i % nb].playerIds.push(pid));
  t.pools = pools;
}

export function launch(t: Tournament): void {
  t.pools.forEach(p => {
    if (!p.order.length) p.order = shuffle(p.playerIds);
    initSurvival(p);
  });
  t.players.forEach(p => { t.points[p.id] = t.points[p.id] || 0; });
  t.status = 'live';
}

function initSurvival(pool: Pool): void {
  if (pool.order.length < 2) { pool.top1 = pool.order[0] || null; pool.phase = 'done'; return; }
  pool.phase = 'survival';
  pool.wSurvivor = pool.order[0];
  pool.wIndex = 1;
  pool.wStreak = 0;
}

/* ---------- Bracket générique (élimination directe) ---------- */

function nextPow2(n: number): number { let p = 1; while (p < n) p *= 2; return p; }

export function buildBracket(ids: string[]): Bracket {
  const q = ids.slice();
  const P = nextPow2(q.length);
  const round0: BracketMatch[] = [];
  for (let i = 0; i < P / 2; i++) {
    const a = q[i] || null;
    const b = q[P - 1 - i] !== undefined ? q[P - 1 - i] : null;
    const m: BracketMatch = { id: uid(), a, b, winner: null, bye: !a || !b };
    if (m.bye) m.winner = a || b;
    round0.push(m);
  }
  const rounds: BracketMatch[][] = [round0];
  let size = P / 2;
  while (size > 1) {
    size = size / 2;
    rounds.push(Array.from({ length: size }, () => ({ id: uid(), a: null, b: null, winner: null, bye: false })));
  }
  const bracket = { rounds };
  propagateBracket(bracket);
  return bracket;
}

export function propagateBracket(bracket: Bracket): void {
  const rounds = bracket.rounds;
  for (let r = 0; r < rounds.length - 1; r++) {
    rounds[r].forEach((m, i) => {
      if (m.winner) {
        const target = rounds[r + 1][Math.floor(i / 2)];
        if (i % 2 === 0) target.a = m.winner; else target.b = m.winner;
      }
    });
  }
}

export function bracketChampion(bracket: Bracket | null): string | null {
  if (!bracket || !bracket.rounds.length) return null;
  const last = bracket.rounds[bracket.rounds.length - 1][0];
  return last.winner || null;
}

export function nextBracketMatch(bracket: Bracket | null): { match: BracketMatch } | null {
  if (!bracket) return null;
  for (const round of bracket.rounds)
    for (const m of round)
      if (m.a && m.b && !m.winner && !m.bye) return { match: m };
  return null;
}

/* ---------- Match courant ---------- */

export interface CurrentMatch { a: string; b: string; stage: Stage; streak: number; matchId?: string; }

export function currentMatch(pool: Pool): CurrentMatch | null {
  if (pool.phase === 'survival') return { a: pool.wSurvivor!, b: pool.order[pool.wIndex], stage: 'survival', streak: pool.wStreak };
  if (pool.phase === 'losers') {
    const nm = nextBracketMatch(pool.lBracket);
    return nm ? { a: nm.match.a!, b: nm.match.b!, stage: 'losers', streak: 0, matchId: nm.match.id } : null;
  }
  if (pool.phase === 'poolFinal') return { a: pool.wChampion!, b: pool.lChampion!, stage: 'poolFinal', streak: 0 };
  return null;
}

function stagePoints(t: Tournament, stage: Stage): number {
  const s = t.scoring;
  return ({ survival: s.survWin, losers: s.loserWin, poolFinal: s.poolFinalWin, finals: s.finalsWin } as Record<string, number>)[stage] || 0;
}

function award(t: Tournament, playerId: string, pts: number): void {
  t.points[playerId] = Math.round(((t.points[playerId] || 0) + pts) * 100) / 100;
}

/* ---------- Résultat (poules) ---------- */

export function reportResult(t: Tournament, poolId: string, winnerId: string, sa = 0, sb = 0): { winnerId: string; loserId: string; pts: number; stage: Stage } | null {
  const pool = t.pools.find(p => p.id === poolId);
  if (!pool) return null;
  const m = currentMatch(pool);
  if (!m) return null;
  // Scores FT : le vainqueur est le côté avec le plus de manches.
  if (sa || sb) winnerId = sa >= sb ? m.a : m.b;
  if (winnerId !== m.a && winnerId !== m.b) return null;

  const loserId = winnerId === m.a ? m.b : m.a;
  const pts = stagePoints(t, m.stage);
  award(t, winnerId, pts);
  t.log.push({ id: uid(), poolId, stage: m.stage, a: m.a, b: m.b, winner: winnerId, pts, ts: Date.now(), sa, sb });

  if (m.stage === 'survival') {
    pool.wLosers.push(loserId);
    if (winnerId === pool.wSurvivor) pool.wStreak++;
    else { pool.wSurvivor = winnerId; pool.wStreak = 1; }
    pool.wBestStreak[winnerId] = Math.max(pool.wBestStreak[winnerId] || 0, pool.wStreak);
    pool.wIndex++;
    if (pool.wIndex >= pool.order.length) { pool.wChampion = pool.wSurvivor; startLosers(pool); }
  } else if (m.stage === 'losers') {
    const nm = nextBracketMatch(pool.lBracket);
    if (nm) { nm.match.winner = winnerId; propagateBracket(pool.lBracket!); }
    const champ = bracketChampion(pool.lBracket);
    if (champ) { pool.lChampion = champ; pool.phase = 'poolFinal'; }
  } else if (m.stage === 'poolFinal') {
    pool.top1 = winnerId; pool.top2 = loserId; pool.phase = 'done';
  }
  return { winnerId, loserId, pts, stage: m.stage };
}

function startLosers(pool: Pool): void {
  const losers = pool.wLosers.slice();
  if (losers.length === 0) { pool.top1 = pool.wChampion; pool.phase = 'done'; }
  else if (losers.length === 1) { pool.lChampion = losers[0]; pool.phase = 'poolFinal'; }
  else {
    pool.phase = 'losers';
    pool.lBracket = buildBracket(losers);
    const champ = bracketChampion(pool.lBracket);
    if (champ) { pool.lChampion = champ; pool.phase = 'poolFinal'; }
  }
}

/* ---------- Phase finale (élimination directe) ---------- */

export function allPoolsDone(t: Tournament): boolean {
  return t.pools.length > 0 && t.pools.every(p => p.phase === 'done');
}

export function qualifiers(t: Tournament): string[] {
  const top1s = t.pools.map(p => p.top1).filter(Boolean) as string[];
  const top2s = (t.pools.map(p => p.top2).filter(Boolean) as string[]).reverse();
  return top1s.concat(top2s);
}

export function startFinals(t: Tournament): void {
  t.finals = buildBracket(qualifiers(t));
}

export function reportFinals(t: Tournament, matchId: string, winnerId: string, sa = 0, sb = 0): { winnerId: string; pts: number } | null {
  if (!t.finals) return null;
  for (const round of t.finals.rounds) {
    const m = round.find(x => x.id === matchId);
    if (!m) continue;
    if (m.bye || m.winner || !m.a || !m.b) return null;
    if (sa || sb) winnerId = sa >= sb ? m.a : m.b;
    if (winnerId !== m.a && winnerId !== m.b) return null;
    m.winner = winnerId;
    const pts = t.scoring.finalsWin;
    award(t, winnerId, pts);
    t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: m.a, b: m.b, winner: winnerId, pts, ts: Date.now(), sa, sb });
    propagateBracket(t.finals);
    const champ = bracketChampion(t.finals);
    if (champ) {
      t.champion = champ;
      award(t, champ, t.scoring.championBonus);
      t.log.push({ id: uid(), poolId: 'finals', stage: 'championBonus', a: champ, b: null, winner: champ, pts: t.scoring.championBonus, ts: Date.now() });
      t.status = 'finished';
      t.finishedAt = Date.now();
    }
    return { winnerId, pts };
  }
  return null;
}

/* ---------- Cagnotte ---------- */

export function cagnotte(t: Tournament): { total: number; programmed: number; gap: number; valid: boolean } {
  const total = t.players.length * t.pointsPerPlayer;
  const s = t.scoring;
  let surv = 0, los = 0, pf = 0;
  const sizes = t.pools.length ? t.pools.map(p => p.playerIds.length) : balancedSizes(t.players.length, t.nbPools);
  sizes.forEach(n => { if (n >= 2) { surv += n - 1; los += Math.max(0, n - 2); pf += 1; } });
  const q = sizes.filter(n => n >= 2).length * 2 + sizes.filter(n => n === 1).length;
  const finalsMatches = Math.max(0, q - 1);
  const programmed = Math.round((surv * s.survWin + los * s.loserWin + pf * s.poolFinalWin + finalsMatches * s.finalsWin + s.championBonus) * 100) / 100;
  return { total, programmed, gap: Math.round((total - programmed) * 100) / 100, valid: programmed <= total };
}

export function distributed(t: Tournament): number {
  return Math.round(Object.values(t.points).reduce((a, b) => a + b, 0) * 100) / 100;
}

/* ---------- Classements ---------- */

export interface RankRow { id: string; name: string; pts: number; wins: number; losses: number; }

export function overallRanking(t: Tournament): RankRow[] {
  const wins: Record<string, number> = {}, losses: Record<string, number> = {};
  t.log.forEach(l => {
    if (l.stage === 'championBonus' || l.stage === 'adjust') return;
    const loser = l.winner === l.a ? l.b : l.a;
    wins[l.winner] = (wins[l.winner] || 0) + 1;
    if (loser) losses[loser] = (losses[loser] || 0) + 1;
  });
  return t.players.slice()
    .sort((x, y) => (t.points[y.id] || 0) - (t.points[x.id] || 0) || (wins[y.id] || 0) - (wins[x.id] || 0))
    .map(p => ({ id: p.id, name: p.name, pts: t.points[p.id] || 0, wins: wins[p.id] || 0, losses: losses[p.id] || 0 }));
}

/* ---------- Survival Rating (ELO) multi-tournois ---------- */

export function ratings(tournaments: Tournament[]): Record<string, number> {
  const R: Record<string, number> = {};
  const BASE = 1000, K = 32;
  const get = (n: string) => { const k = n.toLowerCase(); if (R[k] === undefined) R[k] = BASE; return R[k]; };
  const matches: { ts: number; w: string; l: string }[] = [];
  tournaments.forEach(t => t.log.forEach(l => {
    if (l.stage === 'adjust' || l.stage === 'championBonus') return;
    const loserId = l.winner === l.a ? l.b : l.a;
    if (!loserId) return;
    matches.push({ ts: l.ts || 0, w: playerName(t, l.winner), l: playerName(t, loserId) });
  }));
  matches.sort((a, b) => a.ts - b.ts);
  matches.forEach(m => {
    const rw = get(m.w), rl = get(m.l);
    const ew = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    R[m.w.toLowerCase()] = rw + K * (1 - ew);
    R[m.l.toLowerCase()] = rl - K * (1 - ew);
  });
  Object.keys(R).forEach(k => R[k] = Math.round(R[k]));
  return R;
}
