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
  streakBonus: number;  // bonus "striker" — série de streakLength victoires d'affilée dans une poule
}

export const BYE = '__bye__';
/** Longueur de série qui déclenche le bonus striker : 3 OU 5 victoires d'affilée, au choix de
 * l'organisateur à la création (pas les deux en même temps sur un même tournoi) — voir Tournament.streakLength. */
export type StreakLength = 3 | 5;
export const DEFAULT_STREAK_LENGTH: StreakLength = 5;

export interface BracketMatch { id: string; a: string | null; b: string | null; winner: string | null; bye: boolean; sa?: number; sb?: number; }
export interface Bracket {
  rounds: BracketMatch[][];
  /** Petite finale (3e place), entre les deux perdants de demi-finale — seulement s'il existe une
   *  vraie demi-finale (4 participants ou plus dans l'arbre). null tant qu'elle n'est pas jouable,
   *  et pour les arbres trop petits pour en avoir une (2-3 participants). */
  thirdPlace: BracketMatch | null;
}

export type PoolPhase = 'pending' | 'survival' | 'losers' | 'poolFinal' | 'double' | 'roundrobin' | 'done';
/**
 * Mode de déroulement de chaque poule (phase 1 du format Survival) :
 * - survival (par défaut, historique) : le vainqueur reste sur le terrain et enchaîne les challengers,
 *   perdants repêchés dans un mini-bracket, finale de poule entre le survivant et le rescapé du repêchage.
 * - double : la poule est jouée comme un mini-bracket à double élimination (mêmes primitives que la
 *   phase finale). Les rencontres du bracket vainqueurs comptent comme `survWin`, celles du bracket
 *   perdants comme `loserWin`, la grande finale de poule (+ reset éventuel) comme `poolFinalWin` —
 *   réutilise le barème existant sans nouveau champ.
 */
/** Mode de jeu à l'intérieur d'une poule. 'roundrobin' (chacun affronte tous les autres de sa
 * poule) est la phase de groupes classique, ouverte à tous les formats à phase finale ;
 * 'survival' et 'double' restent les deux modes historiques du format Survival. */
export type PoolFormat = 'survival' | 'double' | 'roundrobin';

export const DEFAULT_QUALIFY_PER_POOL = 2;
/** Borne le nombre de qualifiés par poule (au moins 1, défaut 2). Pas de plafond arbitraire ici :
 * chaque appelant re-borne déjà par l'effectif réel d'une poule (slice()/Math.min() naturellement
 * sans dépassement), donc le seul cap produit vient de maxQualifyPerPool selon le mode de poule. */
export function clampQualifyPerPool(v?: number): number {
  return Math.max(1, Math.round(Number(v) || DEFAULT_QUALIFY_PER_POOL));
}
/** Une poule ne désigne que deux finalistes en mode 'survival'/'double' (vainqueur du bracket
 * vainqueurs et vainqueur du bracket perdants) : structurellement borné à 2, quel que soit
 * l'effectif. Le mode 'roundrobin' produit un classement complet — rien ne le borne ici, sa seule
 * limite réelle est l'effectif de la poule (appliqué par l'appelant, poule par poule). */
export function maxQualifyPerPool(poolFormat: PoolFormat): number {
  return poolFormat === 'roundrobin' ? Infinity : 2;
}

export interface Pool {
  id: string; name: string;
  playerIds: string[]; order: string[];
  phase: PoolPhase;
  wSurvivor: string | null; wIndex: number; wLosers: string[]; wChampion: string | null;
  wStreak: number; wBestStreak: Record<string, number>;
  lBracket: Bracket | null; lChampion: string | null;
  top1: string | null; top2: string | null;
  /** Bracket double élimination de la poule — seulement si le tournoi utilise poolFormat 'double'. */
  dbracket: DoubleFinals | null;
  /** Rencontres de la poule en mode 'roundrobin' — chacun affronte tous les autres de sa poule. */
  rrmatches: BracketMatch[] | null;
  /** Qualifiés de la poule, dans l'ordre du classement — généralise top1/top2 à N qualifiés (voir
   *  Tournament.qualifyPerPool). Vide sur d'anciennes données : retomber sur top1/top2. */
  qualified: string[];
  /** Série de victoires en cours par joueur dans cette poule (matchs de stage 'survival' uniquement,
   *  remise à 0 dès une défaite) — sert au bonus striker, pour les deux modes de poule. */
  streaks: Record<string, number>;
  /** Joueurs ayant déjà touché le bonus striker dans cette poule (une seule fois chacun). */
  streakAwarded: Record<string, boolean>;
}

export type Stage = 'survival' | 'losers' | 'poolFinal' | 'finals' | 'championBonus' | 'streakBonus' | 'adjust';

export interface LogEntry {
  id: string; poolId: string; stage: Stage;
  a: string | null; b: string | null; winner: string;
  pts: number; ts: number; reason?: string;
  sa?: number; sb?: number; // scores FT du match (côté a / côté b)
}

export type Status = 'setup' | 'live' | 'finished';

export type FinalsFormat = 'single' | 'double' | 'roundrobin';

/**
 * Format principal du tournoi (phase de poules) :
 * - survival (par défaut, rétrocompatible) : poules Survival + repêchage + finale de poule, cagnotte pilotée par le barème.
 * - single/double/roundrobin : le tournoi ENTIER est directement un bracket/round-robin (pas de poules) —
 *   réutilise telle quelle la structure et les fonctions déjà écrites pour la phase finale de Survival.
 * - swiss : appariement par rondes selon le classement courant, sans réutiliser matchs déjà joués quand c'est possible.
 * - battle_royale : parties à N joueurs classées du 1er au dernier, points par palier (pas de duels 1v1).
 * Le barème détaillé (survWin/loserWin/poolFinalWin) ne concerne QUE le format survival ; les autres formats
 * utilisent simplement scoring.finalsWin comme "points par victoire/partie" et scoring.championBonus au sacre.
 */
export type TournamentFormat = 'survival' | 'single' | 'double' | 'roundrobin' | 'swiss' | 'battle_royale';

export interface SingleFinals { format: 'single'; bracket: Bracket; }
export interface RoundRobinFinals { format: 'roundrobin'; players: string[]; matches: BracketMatch[]; }
export interface DoubleFinals {
  format: 'double';
  wb: BracketMatch[][]; lb: BracketMatch[][];
  gf: BracketMatch; gf2: BracketMatch | null;
  wbChampion: string | null; lbChampion: string | null;
}
/** Une ronde = les matchs de cette ronde (appariements). Les rondes précédentes sont conservées pour l'historique/l'affiche. */
export interface SwissFinals { format: 'swiss'; rounds: BracketMatch[][]; roundCount: number; }
export interface BRGame { id: string; ranking: string[] | null; }
export interface BattleRoyaleFinals { format: 'battle_royale'; games: BRGame[]; pointsTable: number[]; }
export type Finals = SingleFinals | DoubleFinals | RoundRobinFinals | SwissFinals | BattleRoyaleFinals;

export interface Tournament {
  id: string; createdAt: number; finishedAt?: number;
  name: string; game: string; date: string; place: string;
  pointsPerPlayer: number; nbPools: number;
  /** Format principal — absent sur d'anciennes données stockées : toujours traiter undefined comme 'survival'. */
  format: TournamentFormat;
  players: Player[];
  disqualified: string[];
  scoring: Scoring;
  pools: Pool[];
  /** Mode des poules (phase 1) — ne concerne que le format 'survival'. Absent sur d'anciennes données : traiter comme 'survival'. */
  poolFormat: PoolFormat;
  /** Nombre de joueurs qualifiés par poule pour la phase finale — au moins 1, borné en pratique par
   *  l'effectif de la plus petite poule (voir maxQualifyPerPool). Absent sur d'anciennes données :
   *  traiter comme 2 (top1 + top2, comportement historique). */
  qualifyPerPool: number;
  /** Longueur de série pour le bonus striker (3 ou 5 victoires d'affilée) — un seul palier actif par
   * tournoi. Absent sur d'anciennes données : traiter comme DEFAULT_STREAK_LENGTH (5). */
  streakLength: StreakLength;
  status: Status;
  log: LogEntry[];
  points: Record<string, number>;
  finals: Finals | null;
  finalsFormat: FinalsFormat;
  champion: string | null;
  /** Format de manche appliqué à tous les matchs du tournoi (poules et phase finale) — purement
   *  informatif pour le moteur (un match reste tranché par un simple vainqueur + score sa/sb) : sert
   *  à afficher "Bo3"/"Course à 10" et à indiquer quand une manche est jouable. Absent sur d'anciennes
   *  données : traiter comme Bo1 (comportement historique, un match = un score final). */
  matchFormat: MatchFormat;
  /** Départage des égalités de victoires par différence de buts/manches (Round Robin — poules et
   *  phase finale) — activé par défaut. Désactivé, seules les victoires comptent (les scores sa/sb
   *  restent saisis et affichés, juste ignorés pour le classement). Absent sur d'anciennes données :
   *  traiter comme true (comportement historique). */
  countGoalDiff: boolean;
  /** Pile d'annulation (états JSON précédents) — interne, jamais renvoyée telle quelle à l'API. */
  _undo?: string[];
}

/** 'bo' (Best of N, N impair) : le premier à (N+1)/2 manches gagne. 'ft' (First To N) : le premier
 *  à N points/manches gagne, N libre (course, pas de majorité à calculer). */
export type MatchFormat = { mode: 'bo' | 'ft'; value: number };
export const DEFAULT_MATCH_FORMAT: MatchFormat = { mode: 'bo', value: 1 };
/** Borne un format de manche : Bo1/3/5/7/9 pour "bo", 1 à 99 pour "ft". */
export function clampMatchFormat(v?: Partial<MatchFormat> | null): MatchFormat {
  const mode = v?.mode === 'ft' ? 'ft' : 'bo';
  if (mode === 'ft') return { mode, value: Math.max(1, Math.min(99, Math.round(Number(v?.value) || 10))) };
  const bo = Math.round(Number(v?.value) || 1);
  const allowed = [1, 3, 5, 7, 9];
  return { mode, value: allowed.includes(bo) ? bo : 1 };
}
/** Nombre de manches à remporter pour gagner un match dans ce format — la majorité en Bo (Bo3 → 2),
 *  la valeur elle-même en Ft (Ft10 → 10). */
export function winsNeeded(f: MatchFormat): number {
  return f.mode === 'ft' ? f.value : Math.ceil(f.value / 2);
}
/** Étiquette courte affichée sur les match(s) et l'en-tête de phase — "Bo3", "Ft10". */
export function matchFormatLabel(f: MatchFormat): string {
  return f.mode === 'ft' ? `Ft${f.value}` : `Bo${f.value}`;
}

const POOL_NAMES = 'ABCDEFGHIJKL'.split('');
const MAX_UNDO = 25;

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
    format: cfg.format || 'survival',
    players: [],
    disqualified: [],
    scoring: cfg.scoring || { survWin: 1, loserWin: 0.5, poolFinalWin: 1.5, finalsWin: 2, championBonus: 3, streakBonus: 0 },
    pools: [],
    // Le mode de poule "survival" (le vainqueur enchaine, les perdants repeches) est la marque de
    // fabrique du format Survival : il ne doit jamais s'appliquer par defaut a un autre format —
    // ceux-la recoivent une vraie phase de groupes "normale" (Round Robin) quand rien n'est precise.
    poolFormat: cfg.poolFormat || ((cfg.format === 'survival' || !cfg.format) ? 'survival' : 'roundrobin'),
    qualifyPerPool: clampQualifyPerPool(cfg.qualifyPerPool),
    streakLength: cfg.streakLength || DEFAULT_STREAK_LENGTH,
    status: 'setup', log: [], points: {}, finals: null,
    finalsFormat: cfg.finalsFormat || 'single',
    matchFormat: clampMatchFormat(cfg.matchFormat),
    countGoalDiff: cfg.countGoalDiff ?? true,
    champion: null, _undo: [],
  };
}

/** Nombre de rondes Swiss standard pour n joueurs (assez pour départager, sans exploser la durée). */
export function swissRoundCount(nPlayers: number): number {
  return Math.max(3, Math.ceil(Math.log2(Math.max(2, nPlayers))));
}

export const DEFAULT_BR_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

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

/** Ajoute un joueur — uniquement avant le lancement (les poules ne sont pas encore figées). */
export function addPlayer(t: Tournament, raw: string): Player | null {
  if (t.status !== 'setup') return null;
  const { name, club } = parseEntry(raw);
  if (!name) return null;
  if (t.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return null;
  const p: Player = { id: uid(), name, club };
  t.players.push(p);
  return p;
}

/** Retire un joueur — uniquement avant le lancement. */
export function removePlayer(t: Tournament, playerId: string): boolean {
  if (t.status !== 'setup') return false;
  const before = t.players.length;
  t.players = t.players.filter(p => p.id !== playerId);
  return t.players.length < before;
}

/** Déplace un joueur dans l'ordre du roster — uniquement avant le lancement. Pour les formats
 * sans poules (single/double/roundrobin/swiss), cet ordre EST le tirage au sort : buildBracket et
 * buildDoubleElim apparient sur t.players tel quel (1er vs dernier, 2e vs avant-dernier…), donc
 * réordonner ici change réellement les oppositions du 1er tour. */
export function movePlayerOrder(t: Tournament, playerId: string, dir: -1 | 1): boolean {
  if (t.status !== 'setup') return false;
  const i = t.players.findIndex(p => p.id === playerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= t.players.length) return false;
  [t.players[i], t.players[j]] = [t.players[j], t.players[i]];
  return true;
}

/** Rebrasse aléatoirement l'ordre du roster — uniquement avant le lancement (voir movePlayerOrder). */
export function shufflePlayerOrder(t: Tournament): boolean {
  if (t.status !== 'setup') return false;
  t.players = shuffle(t.players);
  return true;
}

/** Renomme un joueur — à tout moment (y compris en direct : coquille repérée pendant le tournoi).
 * Refuse un nom déjà porté par un autre participant : setPlayers/addPlayer interdisent déjà les
 * homonymes à la saisie, et les classements agrégés le sont par nom (voir leaderboard côté API) —
 * deux « Alice » dans le même tournoi cumuleraient leurs points sur une seule ligne. */
export function renamePlayer(t: Tournament, id: string, newName: string): { ok: boolean; reason?: 'not-found' | 'empty' | 'duplicate' } {
  const p = t.players.find(x => x.id === id);
  if (!p) return { ok: false, reason: 'not-found' };
  const nm = String(newName).trim();
  if (!nm) return { ok: false, reason: 'empty' };
  if (t.players.some(x => x.id !== id && x.name.toLowerCase() === nm.toLowerCase())) return { ok: false, reason: 'duplicate' };
  p.name = nm;
  return { ok: true };
}

/** Modifie le club affiché d'un joueur — à tout moment. */
export function setPlayerClub(t: Tournament, id: string, club: string): boolean {
  const p = t.players.find(x => x.id === id);
  if (!p) return false;
  p.club = String(club).trim();
  return true;
}

export function playerName(t: Tournament, id: string | null): string {
  const p = t.players.find(x => x.id === id);
  return p ? p.name : '?';
}

/* ---------- Historique (annuler) ---------- */

/** Empile un instantané de l'état courant (hors pile elle-même) avant une action mutante. */
function snapshot(t: Tournament): void {
  const stack = t._undo || (t._undo = []);
  t._undo = [];
  const snap = JSON.stringify(t);
  t._undo = stack;
  t._undo.push(snap);
  if (t._undo.length > MAX_UNDO) t._undo.shift();
}

/** Restaure l'état précédent (dernier résultat, ajustement, changement de barème…) — l'appelant doit remplacer sa référence par la valeur retournée. */
export function undo(t: Tournament): Tournament | null {
  if (!t._undo || !t._undo.length) return null;
  const snap = JSON.parse(t._undo.pop()!) as Tournament;
  snap._undo = t._undo;
  return snap;
}

/** Remet le tournoi à l'état "à lancer" (garde joueurs, config des poules et barème). */
export function resetTournament(t: Tournament): void {
  snapshot(t);
  t.pools = [];
  t.finals = null;
  t.champion = null;
  t.log = [];
  t.points = {};
  t.disqualified = [];
  t.status = 'setup';
  delete t.finishedAt;
}

/* ---------- Barème (déplafonné) ---------- */

export function scoringBounds(key: keyof Scoring): { min: number; max: number } {
  return key === 'championBonus' || key === 'streakBonus' ? { min: 0, max: 999 } : { min: 0.25, max: 999 };
}

/** Resynchronise tous les points déjà attribués avec le barème courant (après setScoring, ou pour rattraper une correction). */
export function recomputePoints(t: Tournament): void {
  const pts: Record<string, number> = {};
  t.log.forEach(l => {
    let p: number;
    if (l.stage === 'adjust') p = l.pts;
    else if (l.stage === 'championBonus') { p = t.scoring.championBonus; l.pts = p; }
    else if (l.stage === 'streakBonus') { p = t.scoring.streakBonus; l.pts = p; }
    else { p = stagePoints(t, l.stage); l.pts = p; }
    pts[l.winner] = Math.round(((pts[l.winner] || 0) + p) * 100) / 100;
  });
  t.players.forEach(pl => { if (pts[pl.id] === undefined) pts[pl.id] = 0; });
  t.points = pts;
}

/** Modifie une valeur du barème (à tout moment) puis resynchronise les points déjà distribués. */
export function setScoring(t: Tournament, key: keyof Scoring, value: number): boolean {
  if (!(key in t.scoring)) return false;
  snapshot(t);
  const b = scoringBounds(key);
  t.scoring[key] = Math.min(b.max, Math.max(b.min, Number(value) || b.min));
  recomputePoints(t);
  return true;
}

/** Bonus/pénalité manuel (peut être négatif), tracé dans le journal avec un motif. */
export function manualAdjust(t: Tournament, playerId: string, delta: number, reason?: string): boolean {
  if (!t.players.some(p => p.id === playerId)) return false;
  const d = Math.round((Number(delta) || 0) * 100) / 100;
  if (!d) return false;
  snapshot(t);
  t.log.push({ id: uid(), poolId: 'admin', stage: 'adjust', a: playerId, b: null, winner: playerId, pts: d, ts: Date.now(), reason: reason || '' });
  recomputePoints(t);
  return true;
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
      dbracket: null, streaks: {}, streakAwarded: {},
      rrmatches: null, qualified: [],
    });
  }
  mixed.forEach((pid, i) => pools[i % nb].playerIds.push(pid));
  t.pools = pools;
}

/** Rebrasse l'ordre de passage d'une poule (avant lancement). */
export function shuffleOrder(pool: Pool): void {
  pool.order = shuffle(pool.playerIds);
}

/** Déplace un joueur dans l'ordre de passage d'une poule (avant lancement) : dir = -1 (monte) ou +1 (descend). */
export function moveInOrder(pool: Pool, index: number, dir: number): boolean {
  const j = index + dir;
  if (index < 0 || index >= pool.order.length || j < 0 || j >= pool.order.length) return false;
  [pool.order[index], pool.order[j]] = [pool.order[j], pool.order[index]];
  return true;
}

/** Déplace un joueur vers la poule adjacente (avant lancement) — rééquilibre manuellement l'effectif
 * des poules après la répartition automatique équilibrée, qui ne peut pas deviner qu'un organisateur
 * veut par exemple qualifier plus de monde d'une poule en particulier. `dir` = -1 (poule précédente
 * dans t.pools) ou +1 (poule suivante). Ajouté en fin d'ordre de la poule cible. Refuse de vider une
 * poule (au moins 1 joueur doit y rester) et refuse hors du statut 'setup'. */
export function movePlayerToPool(t: Tournament, playerId: string, poolId: string, dir: number): boolean {
  if (t.status !== 'setup') return false;
  const idx = t.pools.findIndex(p => p.id === poolId);
  if (idx < 0) return false;
  const targetIdx = idx + (dir < 0 ? -1 : 1);
  if (targetIdx < 0 || targetIdx >= t.pools.length) return false;
  const from = t.pools[idx];
  const to = t.pools[targetIdx];
  if (!from.playerIds.includes(playerId)) return false;
  if (from.playerIds.length <= 1) return false;
  from.playerIds = from.playerIds.filter(id => id !== playerId);
  from.order = from.order.filter(id => id !== playerId);
  to.playerIds.push(playerId);
  to.order.push(playerId);
  return true;
}

export function launch(t: Tournament): void {
  t.pools.forEach(p => {
    if (!p.order.length) p.order = shuffle(p.playerIds);
    if (t.poolFormat === 'roundrobin') initPoolRoundRobin(p);
    else if (t.poolFormat === 'double') initPoolDouble(p);
    else initSurvival(p);
  });
  t.players.forEach(p => { t.points[p.id] = t.points[p.id] || 0; });
  t.status = 'live';
}

/** Lance une poule en mini-bracket double élimination (poolFormat 'double') — mêmes primitives que la phase finale. */
function initPoolDouble(pool: Pool): void {
  if (pool.order.length < 2) { pool.top1 = pool.order[0] || null; pool.phase = 'done'; return; }
  pool.dbracket = buildDoubleElim(pool.order);
  pool.phase = 'double';
  checkPoolDoubleChampion(pool); // couronne immédiatement les cas triviaux (2 joueurs : grande finale déjà en bye)
}

/** Détecte la fin du mini-bracket double élim d'une poule (avec reset éventuel) et pose top1/top2. */
function checkPoolDoubleChampion(pool: Pool): void {
  const f = pool.dbracket;
  if (!f || pool.phase !== 'double' || !f.gf.winner) return;
  if (f.gf.winner === f.gf.a) { pool.top1 = f.gf.a; pool.top2 = f.gf.b; pool.phase = 'done'; }
  else if (f.gf2 && f.gf2.winner) { pool.top1 = f.gf2.winner; pool.top2 = f.gf2.winner === f.gf2.a ? f.gf2.b : f.gf2.a; pool.phase = 'done'; }
  else if (!f.gf2) f.gf2 = { id: uid(), a: f.gf.a, b: f.gf.b, winner: null, bye: false };
}

/** Lance une poule en mini round robin (poolFormat 'roundrobin') : chacun affronte tous les autres
 *  de sa poule. Le classement de poule désigne ensuite les qualifiés (voir qualifyPerPool). */
function initPoolRoundRobin(pool: Pool): void {
  if (pool.order.length < 2) {
    pool.top1 = pool.order[0] || null;
    pool.qualified = pool.order.slice(0, 1);
    pool.phase = 'done';
    return;
  }
  pool.rrmatches = buildRoundRobin(pool.order).matches;
  pool.phase = 'roundrobin';
}

/** Classement d'une poule round robin : victoires, puis différence de manches, puis points acquis.
 *  "played" (matchs joués) et la défaite qui s'en déduit (played - wins) sont exposés pour un vrai
 *  tableau de championnat (# / Équipe / J / G / P / Pts) plutôt qu'une seule colonne victoires. */
export function poolRRRanking(t: Tournament, pool: Pool): { id: string; wins: number; played: number; gd: number }[] {
  const ids = pool.order.length ? pool.order : pool.playerIds;
  const wins: Record<string, number> = {}, played: Record<string, number> = {}, gd: Record<string, number> = {};
  ids.forEach(id => { wins[id] = 0; played[id] = 0; gd[id] = 0; });
  (pool.rrmatches || []).forEach(m => {
    if (!m.winner || !m.a || !m.b) return;
    wins[m.winner] = (wins[m.winner] || 0) + 1;
    played[m.a] = (played[m.a] || 0) + 1;
    played[m.b] = (played[m.b] || 0) + 1;
    if (m.sa !== undefined && m.sb !== undefined) {
      gd[m.a] = (gd[m.a] || 0) + (m.sa - m.sb);
      gd[m.b] = (gd[m.b] || 0) + (m.sb - m.sa);
    }
  });
  return ids.slice()
    .sort((x, y) => (wins[y] || 0) - (wins[x] || 0) || (t.countGoalDiff ? (gd[y] || 0) - (gd[x] || 0) : 0) || (t.points[y] || 0) - (t.points[x] || 0))
    .map(id => ({ id, wins: wins[id] || 0, played: played[id] || 0, gd: gd[id] || 0 }));
}

/** Fin d'une poule round robin : toutes les rencontres jouées — classement, qualifiés, top1/top2. */
function checkPoolRoundRobinDone(t: Tournament, pool: Pool): void {
  if (pool.phase !== 'roundrobin') return;
  const ms = pool.rrmatches || [];
  if (!ms.length || !ms.every(m => m.winner || m.bye)) return;
  const rank = poolRRRanking(t, pool).map(r => r.id).filter(id => !t.disqualified.includes(id));
  pool.qualified = rank.slice(0, clampQualifyPerPool(t.qualifyPerPool));
  pool.top1 = rank[0] || null;
  pool.top2 = rank[1] || null;
  pool.phase = 'done';
}

function initSurvival(pool: Pool): void {
  if (pool.order.length < 2) { pool.top1 = pool.order[0] || null; pool.phase = 'done'; return; }
  pool.phase = 'survival';
  pool.wSurvivor = pool.order[0];
  pool.wIndex = 1;
  pool.wStreak = 0;
}

/**
 * Point d'entrée unique du lancement, quel que soit le format. Le format survival garde
 * exactement le comportement historique (poules). Les autres formats n'ont pas de poules :
 * le tournoi entier est directement la structure de compétition (bracket, rondes Swiss, parties BR).
 */
/** Formats à phase finale qui acceptent une phase de groupes optionnelle en amont. */
export const POOLED_FORMATS: TournamentFormat[] = ['single', 'double', 'roundrobin'];
/** Le tournoi passe-t-il par une phase de groupes ? Survival en a toujours ; les formats à phase
 *  finale en ont une dès que l'organisateur demande plus d'une poule. */
export function usesPools(t: Tournament): boolean {
  if (t.format === 'survival' || !t.format) return true;
  return POOLED_FORMATS.indexOf(t.format) >= 0 && (t.nbPools || 1) > 1;
}

export function launchTournament(t: Tournament): void {
  if (t.format === 'survival' || !t.format) { launch(t); return; }
  // Phase de groupes optionnelle : si l'organisateur a demandé plusieurs poules, on les joue
  // d'abord ; les qualifiés se retrouvent ensuite en phase finale dans le format principal du
  // tournoi (startFinals lit finalsFormat).
  if (usesPools(t)) {
    if (!t.pools.length) distributePools(t);
    t.finalsFormat = t.format as FinalsFormat;
    launch(t);
    return;
  }
  snapshot(t);
  t.pools = []; // pas de poules hors survival — efface une éventuelle répartition prévisualisée avant le lancement
  const ids = t.players.map(p => p.id);
  t.players.forEach(p => { t.points[p.id] = t.points[p.id] || 0; });
  // Posé AVANT le montage du format : un format qui se termine immédiatement (ex. Swiss à
  // effectif impair réduit à des exempts) doit pouvoir écraser ce 'live' par 'finished' via
  // finishFinals — pas l'inverse.
  t.status = 'live';
  if (t.format === 'swiss') {
    t.finals = { format: 'swiss', rounds: [], roundCount: swissRoundCount(ids.length) };
    generateSwissRound(t); // peut déjà couronner le champion (cascade interne) pour un très petit effectif
  } else if (t.format === 'battle_royale') {
    const nGames = Math.max(1, t.nbPools || 3); // réutilise nbPools comme "nombre de parties" pour ce format (pas de poules ici)
    t.finals = { format: 'battle_royale', games: Array.from({ length: nGames }, () => ({ id: uid(), ranking: null })), pointsTable: DEFAULT_BR_POINTS };
  } else if (t.format === 'roundrobin') {
    const rr = buildRoundRobin(ids);
    t.finals = { format: 'roundrobin', players: rr.players, matches: rr.matches };
    checkFinalsChampion(t); // couronne immédiatement les cas triviaux (0-1 match, ex. 1-2 joueurs)
  } else if (t.format === 'double') {
    t.finals = buildDoubleElim(ids);
    checkFinalsChampion(t);
  } else {
    t.finals = { format: 'single', bracket: buildBracket(ids) };
    checkFinalsChampion(t);
  }
}

/* ---------- Bracket générique (élimination directe) ---------- */

function nextPow2(n: number): number { let p = 1; while (p < n) p *= 2; return p; }

/** Ordre de placement standard d'un arbre à `size` places, construit par miroirs successifs :
 *  chaque paire de places somme à size+1, si bien que les têtes de série 1 et 2 ne peuvent se
 *  rencontrer qu'en finale. C'est aussi ce qui RÉPARTIT les exempts : avec 23 joueurs sur 32 places,
 *  les 9 places vides tombent aux quatre coins de l'arbre au lieu d'être toutes groupées en tête
 *  (l'appariement naïf i / P-1-i les entassait dans la moitié haute). */
function seedSlots(size: number): number[] {
  let arr = [1, 2];
  while (arr.length < size) {
    const sum = arr.length * 2 + 1;
    const next: number[] = [];
    for (const seed of arr) { next.push(seed); next.push(sum - seed); }
    arr = next;
  }
  return arr;
}

export function buildBracket(ids: string[]): Bracket {
  const q = ids.slice();
  // Minimum 2 places : à un seul participant, nextPow2 renvoie 1 et le tour initial appariait le
  // joueur avec lui-même au lieu de le déclarer exempt.
  const P = Math.max(2, nextPow2(q.length));
  const slots = seedSlots(P); // le n-ième participant de la liste est la tête de série n
  const round0: BracketMatch[] = [];
  for (let i = 0; i < P / 2; i++) {
    const a = q[slots[2 * i] - 1] ?? null;
    const b = q[slots[2 * i + 1] - 1] ?? null;
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
  // Une demi-finale n'existe que si le round precedant la finale compte deux matchs (P >= 4) —
  // a P = 2 il n'y a que la finale, personne a departager pour la 3e place.
  const semis = rounds.length >= 2 ? rounds[rounds.length - 2] : null;
  // Egalement absente si l'une des deux demi-finales est un bye (ex. 3 participants -> P=4, une
  // demi n'a qu'un seul vrai joueur) : il n'y aurait alors qu'un seul perdant reel a en departager,
  // jamais deux -> mieux vaut ne pas creer un match qui resterait pour toujours injouable.
  const thirdPlace = semis && semis.length === 2 && !semis[0].bye && !semis[1].bye
    ? { id: uid(), a: null, b: null, winner: null, bye: false } : null;
  const bracket: Bracket = { rounds, thirdPlace };
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
  // Petite finale : les deux perdants de demi-finale, des que les deux resultats sont connus. Un
  // demi decide par un bye (pas de vrai 4e participant) ne fournit pas de perdant legitime.
  if (bracket.thirdPlace && rounds.length >= 2) {
    const semis = rounds[rounds.length - 2];
    if (semis.length === 2) {
      const loserOf = (m: BracketMatch) => (m.winner && !m.bye ? (m.winner === m.a ? m.b : m.a) : null);
      bracket.thirdPlace.a = loserOf(semis[0]);
      bracket.thirdPlace.b = loserOf(semis[1]);
    }
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
  if (pool.phase === 'roundrobin') {
    // Toutes les rencontres d'une poule round robin sont équivalentes : même catégorie de points
    // que le bracket vainqueurs (survWin), et elles alimentent donc aussi le bonus striker.
    const m = (pool.rrmatches || []).find(x => x.a && x.b && !x.winner && !x.bye);
    return m ? { a: m.a!, b: m.b!, stage: 'survival', streak: pool.streaks[m.a!] || 0, matchId: m.id } : null;
  }
  if (pool.phase === 'double') {
    const f = pool.dbracket; if (!f) return null;
    const playable = (arr: BracketMatch[]) => arr.find(x => x.a && x.b && !x.winner && !x.bye && x.a !== BYE && x.b !== BYE);
    // Bracket vainqueurs → survWin, bracket perdants → loserWin, grande finale (+ reset) → poolFinalWin : mêmes catégories que le mode Survival classique.
    let m = playable(f.wb.flat()); let stage: Stage = 'survival';
    if (!m) { m = playable(f.lb.flat()); stage = 'losers'; }
    if (!m) { m = playable(f.gf2 ? [f.gf, f.gf2] : [f.gf]); stage = 'poolFinal'; }
    return m ? { a: m.a!, b: m.b!, stage, streak: pool.streaks[m.a!] || 0, matchId: m.id } : null;
  }
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

export function reportResult(t: Tournament, poolId: string, winnerId: string, sa = 0, sb = 0, reason?: string): { winnerId: string; loserId: string; pts: number; stage: Stage } | null {
  const pool = t.pools.find(p => p.id === poolId);
  if (!pool) return null;
  const m = currentMatch(pool);
  if (!m) return null;
  // Scores FT : le vainqueur est le côté avec le plus de manches.
  if (sa || sb) winnerId = sa >= sb ? m.a : m.b;
  if (winnerId !== m.a && winnerId !== m.b) return null;

  snapshot(t);
  const loserId = winnerId === m.a ? m.b : m.a;
  const pts = stagePoints(t, m.stage);
  award(t, winnerId, pts);
  t.log.push({ id: uid(), poolId, stage: m.stage, a: m.a, b: m.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });

  // Bonus striker : série de t.streakLength (3 OU 5, un seul palier actif par tournoi) victoires
  // d'affilée sur le "bracket vainqueurs" de la poule (stage 'survival', que la poule soit en mode
  // classique ou double élim) — une seule fois par joueur dans la poule.
  if (m.stage === 'survival') {
    pool.streaks[winnerId] = (pool.streaks[winnerId] || 0) + 1;
    pool.streaks[loserId] = 0;
    const streak = pool.streaks[winnerId];
    const streakLength = t.streakLength || DEFAULT_STREAK_LENGTH;
    if (streak >= streakLength && t.scoring.streakBonus > 0 && !pool.streakAwarded[winnerId]) {
      pool.streakAwarded[winnerId] = true;
      award(t, winnerId, t.scoring.streakBonus);
      t.log.push({ id: uid(), poolId, stage: 'streakBonus', a: winnerId, b: null, winner: winnerId, pts: t.scoring.streakBonus, ts: Date.now(), reason: `Série de ${streakLength} victoires` });
    }
  }

  if (pool.phase === 'roundrobin') {
    const match = (pool.rrmatches || []).find(x => x.id === m.matchId);
    if (match) { match.winner = winnerId; if (sa || sb) { match.sa = sa; match.sb = sb; } }
    checkPoolRoundRobinDone(t, pool);
  } else if (pool.phase === 'double') {
    const f = pool.dbracket!;
    const match = ([] as BracketMatch[]).concat(f.wb.flat(), f.lb.flat(), [f.gf], f.gf2 ? [f.gf2] : []).find(x => x.id === m.matchId);
    if (match) { match.winner = winnerId; if (sa || sb) { match.sa = sa; match.sb = sb; } propagateDouble(f); }
    checkPoolDoubleChampion(pool);
  } else if (m.stage === 'survival') {
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

/* ---------- Phase finale (3 formats) ---------- */

export function allPoolsDone(t: Tournament): boolean {
  return t.pools.length > 0 && t.pools.every(p => p.phase === 'done');
}

export function qualifiers(t: Tournament): string[] {
  const n = clampQualifyPerPool(t.qualifyPerPool);
  // Compat : poules antérieures au champ qualified, et modes survival/double qui ne désignent
  // que deux finalistes — on retombe sur top1/top2, naturellement borné à 2 par le slice.
  const perPool = t.pools.map(p => (p.qualified && p.qualified.length
    ? p.qualified
    : ([p.top1, p.top2].filter(Boolean) as string[])).slice(0, n));
  // Un joueur disqualifié ne doit jamais accéder à la phase finale, même s'il a
  // terminé top1/top2 de sa poule via un forfait adverse antérieur.
  // Serpentin : les 1ers dans l'ordre des poules, les 2es en ordre inverse, etc. — évite que deux
  // qualifiés d'une même poule se retrouvent systématiquement du même côté du bracket.
  // Borné par la plus grande liste réellement qualifiée (pas par `n`, qui n'a plus de plafond
  // arbitraire depuis clampQualifyPerPool) : sinon un qualifyPerPool démesuré ferait tourner cette
  // boucle pour rien après que perPool s'est déjà tarie.
  const cap = perPool.reduce((m, q) => Math.max(m, q.length), 0);
  const out: string[] = [];
  for (let rank = 0; rank < cap; rank++) {
    const row = perPool.map(q => q[rank]).filter(Boolean) as string[];
    out.push(...(rank % 2 === 1 ? row.reverse() : row));
  }
  return out.filter(id => !t.disqualified.includes(id));
}

function buildRoundRobin(ids: string[]): { players: string[]; matches: BracketMatch[] } {
  const matches: BracketMatch[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      matches.push({ id: uid(), a: ids[i], b: ids[j], winner: null, bye: false });
  return { players: ids.slice(), matches };
}

/** Classement round robin : victoires puis différence de manches puis points. */
export function rrRanking(t: Tournament): { id: string; wins: number; played: number; gd: number }[] {
  if (!t.finals || t.finals.format !== 'roundrobin') return [];
  const rr = t.finals;
  const wins: Record<string, number> = {}, played: Record<string, number> = {}, gd: Record<string, number> = {}, gf: Record<string, number> = {};
  const beat: Record<string, Set<string>> = {}; // qui a battu qui, pour la confrontation directe
  rr.players.forEach(id => { wins[id] = 0; played[id] = 0; gd[id] = 0; gf[id] = 0; beat[id] = new Set(); });
  rr.matches.forEach(m => {
    if (!m.winner || !m.a || !m.b) return;
    wins[m.winner] = (wins[m.winner] || 0) + 1;
    played[m.a] = (played[m.a] || 0) + 1; played[m.b] = (played[m.b] || 0) + 1;
    beat[m.winner].add(m.winner === m.a ? m.b : m.a);
    if (m.sa != null && m.sb != null) {
      gd[m.a] = (gd[m.a] || 0) + (m.sa - m.sb); gd[m.b] = (gd[m.b] || 0) + (m.sb - m.sa);
      gf[m.a] = (gf[m.a] || 0) + m.sa; gf[m.b] = (gf[m.b] || 0) + m.sb;
    }
  });
  // Departage standard : victoires, puis difference de buts, puis buts marques, puis confrontation
  // directe (tranchable seulement entre deux joueurs qui se sont affrontes — un blocage a 3+ retombe
  // sur le critere precedent, comme la plupart des reglements amateurs qui n'ouvrent pas de mini-poule).
  return rr.players.slice()
    .sort((x, y) =>
      wins[y] - wins[x]
      || (t.countGoalDiff ? gd[y] - gd[x] || gf[y] - gf[x] || (beat[y].has(x) ? 1 : 0) - (beat[x].has(y) ? 1 : 0) : 0)
      || (t.points[y] || 0) - (t.points[x] || 0))
    .map(id => ({ id, wins: wins[id], played: played[id], gd: gd[id] }));
}

function placeSlot(m: BracketMatch, slot: 0 | 1, val: string | null): boolean {
  const key = slot ? 'b' : 'a';
  if (m[key] == null && val != null) { m[key] = val; return true; }
  return false;
}

function resolveBye(m: BracketMatch): boolean {
  if (m.winner) return false;
  const aB = m.a === BYE, bB = m.b === BYE;
  const aR = !!m.a && !aB, bR = !!m.b && !bB;
  if (aR && bB) { m.winner = m.a; m.bye = true; return true; }
  if (bR && aB) { m.winner = m.b; m.bye = true; return true; }
  if (aB && bB) { m.winner = BYE; m.bye = true; return true; }
  return false;
}

function buildDoubleElim(ids: string[]): DoubleFinals {
  const P = Math.max(2, nextPow2(ids.length));
  const seeds = ids.slice();
  while (seeds.length < P) seeds.push(BYE);
  const R = Math.round(Math.log2(P));
  const mk = (): BracketMatch => ({ id: uid(), a: null, b: null, winner: null, bye: false });
  const wb: BracketMatch[][] = [];
  const slots = seedSlots(P);
  const r0: BracketMatch[] = [];
  for (let i = 0; i < P / 2; i++) r0.push({ id: uid(), a: seeds[slots[2 * i] - 1], b: seeds[slots[2 * i + 1] - 1], winner: null, bye: false });
  wb.push(r0);
  let size = P / 2;
  for (let r = 1; r < R; r++) { size = size / 2; wb.push(Array.from({ length: size }, mk)); }
  const lb: BracketMatch[][] = [];
  const lbCount = Math.max(0, 2 * R - 2);
  for (let e = 0; e < lbCount; e++) {
    const k = Math.floor(e / 2);
    const s = Math.max(1, P / Math.pow(2, k + 2));
    lb.push(Array.from({ length: s }, mk));
  }
  const fin: DoubleFinals = { format: 'double', wb, lb, gf: mk(), gf2: null, wbChampion: null, lbChampion: null };
  propagateDouble(fin);
  return fin;
}

function propagateDouble(fin: DoubleFinals): void {
  let changed = true, guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (let r = 0; r < fin.wb.length; r++) {
      fin.wb[r].forEach((m, i) => {
        if (resolveBye(m)) changed = true;
        if (!m.winner) return;
        if (r + 1 < fin.wb.length) { if (placeSlot(fin.wb[r + 1][Math.floor(i / 2)], (i % 2) as 0 | 1, m.winner)) changed = true; }
        else if (fin.wbChampion !== m.winner && m.winner !== BYE) { fin.wbChampion = m.winner; changed = true; }
        let drop: string | null;
        if (m.winner === BYE) drop = BYE;
        else { const loser = m.winner === m.a ? m.b : m.a; drop = loser ?? null; }
        if (drop != null && fin.lb.length) {
          if (r === 0) { if (placeSlot(fin.lb[0][Math.floor(i / 2)], (i % 2) as 0 | 1, drop)) changed = true; }
          else if (2 * r - 1 < fin.lb.length) { if (placeSlot(fin.lb[2 * r - 1][i], 1, drop)) changed = true; }
        }
      });
    }
    for (let e = 0; e < fin.lb.length; e++) {
      fin.lb[e].forEach((m, i) => {
        if (resolveBye(m)) changed = true;
        if (!m.winner) return;
        if (e + 1 < fin.lb.length) {
          if (e % 2 === 0) { if (placeSlot(fin.lb[e + 1][i], 0, m.winner)) changed = true; }
          else { if (placeSlot(fin.lb[e + 1][Math.floor(i / 2)], (i % 2) as 0 | 1, m.winner)) changed = true; }
        } else if (fin.lbChampion !== m.winner && m.winner !== BYE) { fin.lbChampion = m.winner; changed = true; }
      });
    }
    if (fin.wbChampion && placeSlot(fin.gf, 0, fin.wbChampion)) changed = true;
    if (fin.lbChampion && placeSlot(fin.gf, 1, fin.lbChampion)) changed = true;
    // cas dégénéré : pas de losers bracket (≤2 qualifiés)
    if (!fin.lb.length && fin.wbChampion && placeSlot(fin.gf, 1, BYE)) changed = true;
    // La grande finale elle-même peut être un bye (1-2 joueurs au total) — sans quoi elle ne se résout jamais.
    if (resolveBye(fin.gf)) changed = true;
    if (fin.gf2 && resolveBye(fin.gf2)) changed = true;
  }
}

export function startFinals(t: Tournament, format?: FinalsFormat): void {
  snapshot(t);
  const q = qualifiers(t);
  const fmt = format || t.finalsFormat || 'single';
  t.finalsFormat = fmt;
  if (fmt === 'roundrobin') {
    const rr = buildRoundRobin(q);
    t.finals = { format: 'roundrobin', players: rr.players, matches: rr.matches };
  } else if (fmt === 'double') {
    t.finals = buildDoubleElim(q);
  } else {
    t.finals = { format: 'single', bracket: buildBracket(q) };
  }
  checkFinalsChampion(t);
}

/** Toutes les rencontres de la phase finale, quel que soit le format — pour recherche/affichage générique. */
export function allFinalsMatches(t: Tournament): BracketMatch[] {
  const f = t.finals; if (!f) return [];
  if (f.format === 'roundrobin') return f.matches;
  if (f.format === 'single') return f.bracket.thirdPlace ? f.bracket.rounds.flat().concat([f.bracket.thirdPlace]) : f.bracket.rounds.flat();
  if (f.format === 'double') return ([] as BracketMatch[]).concat(f.wb.flat(), f.lb.flat(), [f.gf], f.gf2 ? [f.gf2] : []);
  if (f.format === 'swiss') return f.rounds.flat();
  return []; // battle_royale : pas de duels 1v1, se pilote via reportBattleRoyale (classement de partie)
}

export function findFinalsMatch(t: Tournament, matchId: string): BracketMatch | null {
  return allFinalsMatches(t).find(m => m.id === matchId) || null;
}

export function reportFinals(t: Tournament, matchId: string, winnerId: string, sa = 0, sb = 0, reason?: string): { winnerId: string; pts: number } | null {
  const f = t.finals; if (!f) return null;
  const match = findFinalsMatch(t, matchId);
  if (!match) return null;
  if (match.bye || match.winner || !match.a || !match.b || match.a === BYE || match.b === BYE) return null;
  if (sa || sb) winnerId = sa >= sb ? match.a : match.b;
  if (winnerId !== match.a && winnerId !== match.b) return null;

  snapshot(t);
  match.winner = winnerId;
  if (sa || sb) { match.sa = sa; match.sb = sb; }
  const pts = t.scoring.finalsWin;
  award(t, winnerId, pts);
  t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: match.a, b: match.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });

  if (f.format === 'single') propagateBracket(f.bracket);
  else if (f.format === 'double') propagateDouble(f);
  checkFinalsChampion(t);
  return { winnerId, pts };
}

function finishFinals(t: Tournament, champId: string | null): void {
  if (!champId || t.status === 'finished') return;
  t.champion = champId;
  award(t, champId, t.scoring.championBonus);
  t.log.push({ id: uid(), poolId: 'finals', stage: 'championBonus', a: champId, b: null, winner: champId, pts: t.scoring.championBonus, ts: Date.now() });
  t.status = 'finished';
  t.finishedAt = Date.now();
}

/** Détecte la fin de la phase finale (tous formats) et couronne le champion. */
function checkFinalsChampion(t: Tournament): void {
  const f = t.finals; if (!f || t.status === 'finished') return;
  if (f.format === 'single') {
    finishFinals(t, bracketChampion(f.bracket));
  } else if (f.format === 'double') {
    if (f.gf.winner) {
      // Bracket reset : si le finaliste du losers bracket gagne la 1re grande finale,
      // on rejoue une 2e grande finale (chacun a alors une défaite).
      if (f.gf.winner === f.gf.a) finishFinals(t, f.gf.a);
      else if (f.gf2 && f.gf2.winner) finishFinals(t, f.gf2.winner);
      else if (!f.gf2) f.gf2 = { id: uid(), a: f.gf.a, b: f.gf.b, winner: null, bye: false };
    }
  } else if (f.format === 'roundrobin') {
    if (f.matches.every(m => m.winner)) { const rk = rrRanking(t); if (rk.length) finishFinals(t, rk[0].id); }
  }
}

/* ---------- Format Swiss (rondes appariées par classement, sans poules) ---------- */

function pairKey(a: string, b: string): string { return a < b ? a + '|' + b : b + '|' + a; }

/** Classement Swiss courant : victoires puis Buchholz (somme des victoires des adversaires affrontés) puis points. */
export function swissStandings(t: Tournament): { id: string; wins: number; buchholz: number }[] {
  const f = t.finals; if (!f || f.format !== 'swiss') return [];
  const wins: Record<string, number> = {};
  const opponents: Record<string, string[]> = {};
  t.players.forEach(p => { wins[p.id] = 0; opponents[p.id] = []; });
  f.rounds.forEach(round => round.forEach(m => {
    if (!m.a) return;
    if (m.b) { opponents[m.a] = (opponents[m.a] || []).concat(m.b); opponents[m.b] = (opponents[m.b] || []).concat(m.a); }
    if (m.winner) wins[m.winner] = (wins[m.winner] || 0) + 1;
  }));
  const buchholz = (id: string) => (opponents[id] || []).reduce((s, oid) => s + (wins[oid] || 0), 0);
  return t.players.slice()
    .sort((a, b) => (wins[b.id] || 0) - (wins[a.id] || 0) || buchholz(b.id) - buchholz(a.id) || (t.points[b.id] || 0) - (t.points[a.id] || 0))
    .map(p => ({ id: p.id, wins: wins[p.id] || 0, buchholz: buchholz(p.id) }));
}

/** Génère la ronde Swiss suivante : apparie par classement courant, évite les rematchs quand c'est possible, exempte le surnombre. */
function generateSwissRound(t: Tournament): void {
  const f = t.finals; if (!f || f.format !== 'swiss') return;
  const ids = t.players.map(p => p.id).filter(id => !t.disqualified.includes(id));
  const standing = swissStandings(t);
  const order = standing.map(s => s.id).filter(id => ids.includes(id));
  const played = new Set<string>();
  f.rounds.forEach(round => round.forEach(m => { if (m.a && m.b) played.add(pairKey(m.a, m.b)); }));

  const used = new Set<string>();
  const matches: BracketMatch[] = [];
  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    if (used.has(a)) continue;
    used.add(a);
    let opp: string | null = null;
    for (let j = i + 1; j < order.length; j++) { const b = order[j]; if (!used.has(b) && !played.has(pairKey(a, b))) { opp = b; break; } }
    if (!opp) for (let j = i + 1; j < order.length; j++) { const b = order[j]; if (!used.has(b)) { opp = b; break; } } // repli : rematch si inévitable (petit effectif)
    if (opp) { used.add(opp); matches.push({ id: uid(), a, b: opp, winner: null, bye: false }); }
    else matches.push({ id: uid(), a, b: null, winner: a, bye: true }); // nombre impair : exempt, victoire automatique
  }
  f.rounds.push(matches);
  matches.forEach(m => {
    if (m.bye && m.winner) {
      const pts = t.scoring.finalsWin;
      award(t, m.winner, pts);
      t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: m.a, b: null, winner: m.winner, pts, ts: Date.now(), reason: 'bye' });
    }
  });
  advanceSwissIfRoundDone(t); // effectif impair au point de n'avoir que des exempts : la ronde est déjà "jouée", il faut enchaîner tout de suite
}

/** Une fois toutes les rencontres de la ronde décidées : ronde suivante, ou couronnement si c'était la dernière. */
function advanceSwissIfRoundDone(t: Tournament): void {
  const f = t.finals; if (!f || f.format !== 'swiss') return;
  const round = f.rounds[f.rounds.length - 1];
  if (!round.length || !round.every(m => m.winner)) return;
  if (f.rounds.length < f.roundCount) generateSwissRound(t);
  else { const st = swissStandings(t); finishFinals(t, st[0]?.id || null); }
}

/** Rapporte le résultat d'un match Swiss de la ronde en cours ; enchaîne la ronde suivante ou couronne le champion. */
export function reportSwiss(t: Tournament, matchId: string, winnerId: string, sa = 0, sb = 0, reason?: string): { winnerId: string; pts: number } | null {
  const f = t.finals; if (!f || f.format !== 'swiss') return null;
  const round = f.rounds[f.rounds.length - 1];
  const match = round && round.find(m => m.id === matchId);
  if (!match || match.winner || match.bye || !match.a || !match.b) return null;
  if (sa || sb) winnerId = sa >= sb ? match.a : match.b;
  if (winnerId !== match.a && winnerId !== match.b) return null;

  snapshot(t);
  match.winner = winnerId;
  if (sa || sb) { match.sa = sa; match.sb = sb; }
  const pts = t.scoring.finalsWin;
  award(t, winnerId, pts);
  t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: match.a, b: match.b, winner: winnerId, pts, ts: Date.now(), sa, sb, ...(reason ? { reason } : {}) });

  advanceSwissIfRoundDone(t);
  return { winnerId, pts };
}

/* ---------- Format Battle Royale (parties à N joueurs, classement par palier de points) ---------- */

/** Rapporte le classement complet d'une partie Battle Royale (ids du 1er au dernier) ; enchaîne ou couronne le champion après la dernière partie. */
export function reportBattleRoyale(t: Tournament, gameId: string, ranking: string[]): { ok: boolean } {
  const f = t.finals; if (!f || f.format !== 'battle_royale') return { ok: false };
  const game = f.games.find(g => g.id === gameId);
  if (!game || game.ranking) return { ok: false };
  const validIds = new Set(t.players.map(p => p.id));
  const clean = ranking.filter(id => validIds.has(id));
  if (!clean.length) return { ok: false };

  snapshot(t);
  game.ranking = clean;
  clean.forEach((pid, i) => {
    const pts = f.pointsTable[i] ?? f.pointsTable[f.pointsTable.length - 1] ?? 0;
    if (pts > 0) { award(t, pid, pts); t.log.push({ id: uid(), poolId: 'finals', stage: 'finals', a: pid, b: null, winner: pid, pts, ts: Date.now() }); }
  });
  if (f.games.every(g => g.ranking)) {
    const top = t.players.slice().sort((a, b) => (t.points[b.id] || 0) - (t.points[a.id] || 0))[0];
    finishFinals(t, top ? top.id : null);
  }
  return { ok: true };
}

/* ---------- Disqualification (en direct) ---------- */

/** Le match en cours (poule ou finale, tous formats) impliquant ce joueur, s'il y en a un. */
function pendingFinalsMatchFor(t: Tournament, playerId: string): BracketMatch | null {
  const f = t.finals; if (!f) return null;
  if (f.format === 'single') {
    const nm = nextBracketMatch(f.bracket);
    return nm && (nm.match.a === playerId || nm.match.b === playerId) ? nm.match : null;
  }
  // Double élim / round robin : plusieurs matchs peuvent être « prêts » en parallèle.
  return allFinalsMatches(t).find(m => !m.winner && !m.bye && m.a && m.b && m.a !== BYE && m.b !== BYE && (m.a === playerId || m.b === playerId)) || null;
}

/**
 * Disqualifie un joueur en cours de tournoi : forfait immédiat sur son match en
 * cours (s'il y en a un, poule ou finale — l'adversaire est déclaré vainqueur via
 * la machine à états existante, ce qui fait avancer poule/bracket normalement) et
 * retrait des files d'attente pas encore atteintes (poule Survival, perdants pas
 * encore engagés dans le bracket de repêchage).
 */
export function disqualifyPlayer(t: Tournament, playerId: string): { ok: boolean; reason?: string } {
  if (t.status !== 'live') return { ok: false, reason: 'not-live' };
  if (!t.players.some(p => p.id === playerId)) return { ok: false, reason: 'not-found' };
  if (t.disqualified.includes(playerId)) return { ok: false, reason: 'already-disqualified' };

  for (const pool of t.pools) {
    if (pool.phase === 'survival') {
      const idx = pool.order.indexOf(playerId);
      if (idx > pool.wIndex) pool.order.splice(idx, 1);
    }
    pool.wLosers = pool.wLosers.filter(id => id !== playerId);
  }

  // Force la défaite tant que le joueur est partie prenante d'un match courant
  // (poule ou finale) — reportResult/reportFinals gèrent toutes les transitions.
  let guard = 0;
  while (guard++ < 200) {
    let acted = false;
    for (const pool of t.pools) {
      const cur = currentMatch(pool);
      if (cur && (cur.a === playerId || cur.b === playerId)) {
        const winner = cur.a === playerId ? cur.b : cur.a;
        reportResult(t, pool.id, winner, 0, 0, 'forfeit');
        acted = true;
      }
    }
    if (t.finals && t.finals.format === 'swiss') {
      const round = t.finals.rounds[t.finals.rounds.length - 1];
      const m = round && round.find(x => !x.winner && !x.bye && x.a && x.b && (x.a === playerId || x.b === playerId));
      if (m) { const winner = (m.a === playerId ? m.b : m.a)!; reportSwiss(t, m.id, winner, 0, 0, 'forfeit'); acted = true; }
    } else {
      const fm = pendingFinalsMatchFor(t, playerId);
      if (fm) {
        const winner = (fm.a === playerId ? fm.b : fm.a)!;
        reportFinals(t, fm.id, winner, 0, 0, 'forfeit');
        acted = true;
      }
    }
    if (!acted) break;
  }

  t.disqualified.push(playerId);
  return { ok: true };
}

/* ---------- Cagnotte ---------- */

/** Nombre de rencontres réelles (hors bye) qui distribuent un `finalsWin`, pour `q` qualifiés selon le
 * format de phase finale — utilisé par cagnotte() pour un budget qui ne se trompe pas de format.
 * 'double' est compté via une vraie simulation de bracket (buildDoubleElim), + la 2e petite finale
 * possible (bracket reset) : jamais de sous-estimation, même si elle ne se joue pas toujours en pratique.
 * 'single' reste `q - 1`, un invariant mathématique vrai quel que soit le nombre de byes. */
function finalsMatchCount(q: number, format: FinalsFormat): number {
  if (q < 2) return 0;
  if (format === 'roundrobin') return (q * (q - 1)) / 2;
  if (format === 'double') {
    const ids = Array.from({ length: q }, (_, i) => 'q' + i);
    const f = buildDoubleElim(ids);
    const real = ([] as BracketMatch[]).concat(f.wb.flat(), f.lb.flat()).filter(m => !m.bye).length;
    return real + (f.gf.bye ? 0 : 2); // grande finale + 2e petite finale (reset) possible
  }
  return q - 1;
}

/** Nombre de rencontres réelles (hors bye) d'un mini-bracket double élim de n joueurs, par catégorie —
 * simulé pour de vrai (comme finalsMatchCount) : jamais de sous-estimation, reset de grande finale inclus. */
function doublePoolMatchCounts(n: number): { wb: number; lb: number; gf: number } {
  if (n < 2) return { wb: 0, lb: 0, gf: 0 };
  const ids = Array.from({ length: n }, (_, i) => 'p' + i);
  const f = buildDoubleElim(ids);
  return {
    wb: f.wb.flat().filter(m => !m.bye).length,
    lb: f.lb.flat().filter(m => !m.bye).length,
    gf: f.gf.bye ? 0 : 2, // grande finale + 2e petite finale possible (reset)
  };
}

export function cagnotte(t: Tournament): { total: number; programmed: number; gap: number; valid: boolean } {
  const total = t.players.length * t.pointsPerPlayer;
  const s = t.scoring;
  let surv = 0, los = 0, pf = 0, nRealPools = 0;
  const sizes = t.pools.length ? t.pools.map(p => p.playerIds.length) : balancedSizes(t.players.length, t.nbPools);
  sizes.forEach(n => {
    if (n < 2) return;
    nRealPools++;
    if (t.poolFormat === 'roundrobin') {
      // Round robin de poule : chacun affronte tous les autres, toutes les rencontres au tarif survWin.
      surv += (n * (n - 1)) / 2;
    } else if (t.poolFormat === 'double') {
      const c = doublePoolMatchCounts(n);
      surv += c.wb; los += c.lb; pf += c.gf;
    } else {
      surv += n - 1; los += Math.max(0, n - 2); pf += 1;
    }
  });
  // Qualifiés : N par poule (borné par ce que le mode de poule sait départager, et par l'effectif
  // réel de la poule) — auparavant figé à 2, ce qui sous-estimait la phase finale dès qu'on en
  // qualifiait davantage, donc sous-budgétait la cagnotte.
  const perPool = Math.min(clampQualifyPerPool(t.qualifyPerPool), maxQualifyPerPool(t.poolFormat));
  const q = sizes.filter(n => n >= 2).reduce((acc, n) => acc + Math.min(perPool, n), 0)
    + sizes.filter(n => n === 1).length;
  const finalsMatches = finalsMatchCount(q, t.finalsFormat);
  // Bonus striker : jamais garanti (dépend des performances), mais on budgète le pire cas réaliste —
  // au plus un joueur strikeur par poule — pour ne jamais sous-estimer la cagnotte nécessaire.
  const programmed = Math.round((surv * s.survWin + los * s.loserWin + pf * s.poolFinalWin + finalsMatches * s.finalsWin + s.championBonus + nRealPools * s.streakBonus) * 100) / 100;
  return { total, programmed, gap: Math.round((total - programmed) * 100) / 100, valid: programmed <= total };
}

/** Un passage de réduction proportionnelle (pas de 0.25, plancher à 0.25) — voir autoFitScoring. */
function autoFitScoringOnce(t: Tournament): void {
  const c = cagnotte(t);
  if (c.programmed <= 0) return;
  const scale = c.total / c.programmed;
  const clamp = (v: number) => Math.min(999, Math.max(0.25, Math.floor(v * scale * 4) / 4));
  const s = t.scoring;
  s.survWin = clamp(s.survWin);
  s.loserWin = clamp(s.loserWin);
  s.poolFinalWin = clamp(s.poolFinalWin);
  s.finalsWin = clamp(s.finalsWin);
  // le bonus champion n'est pas rogné automatiquement (choix de l'organisateur)
}

/** Ajuste proportionnellement le barème pour tenir dans la cagnotte. Un seul passage peut laisser
 * un léger dépassement résiduel (chaque catégorie a un plancher de 0.25, donc l'arrondi au pas
 * de 0.25 après mise à l'échelle ne garantit pas individuellement le budget) — on répète jusqu'à
 * rentrer dans la cagnotte ou jusqu'à ce qu'un passage supplémentaire ne change plus rien (toutes
 * les catégories réductibles sont au plancher : le dépassement restant vient alors du bonus champion
 * seul, volontairement non rogné). */
export function autoFitScoring(t: Tournament): void {
  snapshot(t);
  for (let i = 0; i < 8; i++) {
    const before = JSON.stringify(t.scoring);
    autoFitScoringOnce(t);
    if (cagnotte(t).valid || JSON.stringify(t.scoring) === before) break;
  }
  recomputePoints(t);
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
