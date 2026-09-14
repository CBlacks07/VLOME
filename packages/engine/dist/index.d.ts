export interface Player {
    id: string;
    name: string;
    club: string;
}
export interface Scoring {
    survWin: number;
    loserWin: number;
    poolFinalWin: number;
    finalsWin: number;
    championBonus: number;
    streakBonus: number;
}
export declare const BYE = "__bye__";
/** Longueur de série qui déclenche le bonus striker : 3 OU 5 victoires d'affilée, au choix de
 * l'organisateur à la création (pas les deux en même temps sur un même tournoi) — voir Tournament.streakLength. */
export type StreakLength = 3 | 5;
export declare const DEFAULT_STREAK_LENGTH: StreakLength;
export interface BracketMatch {
    id: string;
    a: string | null;
    b: string | null;
    winner: string | null;
    bye: boolean;
    sa?: number;
    sb?: number;
}
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
export declare const DEFAULT_QUALIFY_PER_POOL = 2;
/** Borne le nombre de qualifiés par poule (au moins 1, défaut 2). Pas de plafond arbitraire ici :
 * chaque appelant re-borne déjà par l'effectif réel d'une poule (slice()/Math.min() naturellement
 * sans dépassement), donc le seul cap produit vient de maxQualifyPerPool selon le mode de poule. */
export declare function clampQualifyPerPool(v?: number): number;
/** Une poule ne désigne que deux finalistes en mode 'survival'/'double' (vainqueur du bracket
 * vainqueurs et vainqueur du bracket perdants) : structurellement borné à 2, quel que soit
 * l'effectif. Le mode 'roundrobin' produit un classement complet — rien ne le borne ici, sa seule
 * limite réelle est l'effectif de la poule (appliqué par l'appelant, poule par poule). */
export declare function maxQualifyPerPool(poolFormat: PoolFormat): number;
export interface Pool {
    id: string;
    name: string;
    playerIds: string[];
    order: string[];
    phase: PoolPhase;
    wSurvivor: string | null;
    wIndex: number;
    wLosers: string[];
    wChampion: string | null;
    wStreak: number;
    wBestStreak: Record<string, number>;
    lBracket: Bracket | null;
    lChampion: string | null;
    top1: string | null;
    top2: string | null;
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
    id: string;
    poolId: string;
    stage: Stage;
    a: string | null;
    b: string | null;
    winner: string;
    pts: number;
    ts: number;
    reason?: string;
    sa?: number;
    sb?: number;
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
export interface SingleFinals {
    format: 'single';
    bracket: Bracket;
}
export interface RoundRobinFinals {
    format: 'roundrobin';
    players: string[];
    matches: BracketMatch[];
}
export interface DoubleFinals {
    format: 'double';
    wb: BracketMatch[][];
    lb: BracketMatch[][];
    gf: BracketMatch;
    gf2: BracketMatch | null;
    wbChampion: string | null;
    lbChampion: string | null;
}
/** Une ronde = les matchs de cette ronde (appariements). Les rondes précédentes sont conservées pour l'historique/l'affiche. */
export interface SwissFinals {
    format: 'swiss';
    rounds: BracketMatch[][];
    roundCount: number;
}
export interface BRGame {
    id: string;
    ranking: string[] | null;
}
export interface BattleRoyaleFinals {
    format: 'battle_royale';
    games: BRGame[];
    pointsTable: number[];
}
export type Finals = SingleFinals | DoubleFinals | RoundRobinFinals | SwissFinals | BattleRoyaleFinals;
export interface Tournament {
    id: string;
    createdAt: number;
    finishedAt?: number;
    name: string;
    game: string;
    date: string;
    place: string;
    pointsPerPlayer: number;
    nbPools: number;
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
    /** Pile d'annulation (états JSON précédents) — interne, jamais renvoyée telle quelle à l'API. */
    _undo?: string[];
}
/** 'bo' (Best of N, N impair) : le premier à (N+1)/2 manches gagne. 'ft' (First To N) : le premier
 *  à N points/manches gagne, N libre (course, pas de majorité à calculer). */
export type MatchFormat = {
    mode: 'bo' | 'ft';
    value: number;
};
export declare const DEFAULT_MATCH_FORMAT: MatchFormat;
/** Borne un format de manche : Bo1/3/5/7/9 pour "bo", 1 à 99 pour "ft". */
export declare function clampMatchFormat(v?: Partial<MatchFormat> | null): MatchFormat;
/** Nombre de manches à remporter pour gagner un match dans ce format — la majorité en Bo (Bo3 → 2),
 *  la valeur elle-même en Ft (Ft10 → 10). */
export declare function winsNeeded(f: MatchFormat): number;
/** Étiquette courte affichée sur les match(s) et l'en-tête de phase — "Bo3", "Ft10". */
export declare function matchFormatLabel(f: MatchFormat): string;
export declare function uid(): string;
export declare function newTournament(cfg?: Partial<Tournament>): Tournament;
/** Nombre de rondes Swiss standard pour n joueurs (assez pour départager, sans exploser la durée). */
export declare function swissRoundCount(nPlayers: number): number;
export declare const DEFAULT_BR_POINTS: number[];
export declare function parseEntry(raw: string): {
    name: string;
    club: string;
};
export declare function setPlayers(t: Tournament, names: string[]): void;
/** Ajoute un joueur — uniquement avant le lancement (les poules ne sont pas encore figées). */
export declare function addPlayer(t: Tournament, raw: string): Player | null;
/** Retire un joueur — uniquement avant le lancement. */
export declare function removePlayer(t: Tournament, playerId: string): boolean;
/** Déplace un joueur dans l'ordre du roster — uniquement avant le lancement. Pour les formats
 * sans poules (single/double/roundrobin/swiss), cet ordre EST le tirage au sort : buildBracket et
 * buildDoubleElim apparient sur t.players tel quel (1er vs dernier, 2e vs avant-dernier…), donc
 * réordonner ici change réellement les oppositions du 1er tour. */
export declare function movePlayerOrder(t: Tournament, playerId: string, dir: -1 | 1): boolean;
/** Rebrasse aléatoirement l'ordre du roster — uniquement avant le lancement (voir movePlayerOrder). */
export declare function shufflePlayerOrder(t: Tournament): boolean;
/** Renomme un joueur — à tout moment (y compris en direct : coquille repérée pendant le tournoi).
 * Refuse un nom déjà porté par un autre participant : setPlayers/addPlayer interdisent déjà les
 * homonymes à la saisie, et les classements agrégés le sont par nom (voir leaderboard côté API) —
 * deux « Alice » dans le même tournoi cumuleraient leurs points sur une seule ligne. */
export declare function renamePlayer(t: Tournament, id: string, newName: string): {
    ok: boolean;
    reason?: 'not-found' | 'empty' | 'duplicate';
};
/** Modifie le club affiché d'un joueur — à tout moment. */
export declare function setPlayerClub(t: Tournament, id: string, club: string): boolean;
export declare function playerName(t: Tournament, id: string | null): string;
/** Restaure l'état précédent (dernier résultat, ajustement, changement de barème…) — l'appelant doit remplacer sa référence par la valeur retournée. */
export declare function undo(t: Tournament): Tournament | null;
/** Remet le tournoi à l'état "à lancer" (garde joueurs, config des poules et barème). */
export declare function resetTournament(t: Tournament): void;
export declare function scoringBounds(key: keyof Scoring): {
    min: number;
    max: number;
};
/** Resynchronise tous les points déjà attribués avec le barème courant (après setScoring, ou pour rattraper une correction). */
export declare function recomputePoints(t: Tournament): void;
/** Modifie une valeur du barème (à tout moment) puis resynchronise les points déjà distribués. */
export declare function setScoring(t: Tournament, key: keyof Scoring, value: number): boolean;
/** Bonus/pénalité manuel (peut être négatif), tracé dans le journal avec un motif. */
export declare function manualAdjust(t: Tournament, playerId: string, delta: number, reason?: string): boolean;
export declare function balancedSizes(nPlayers: number, nbPools: number): number[];
export declare function distributePools(t: Tournament): void;
/** Rebrasse l'ordre de passage d'une poule (avant lancement). */
export declare function shuffleOrder(pool: Pool): void;
/** Déplace un joueur dans l'ordre de passage d'une poule (avant lancement) : dir = -1 (monte) ou +1 (descend). */
export declare function moveInOrder(pool: Pool, index: number, dir: number): boolean;
/** Déplace un joueur vers la poule adjacente (avant lancement) — rééquilibre manuellement l'effectif
 * des poules après la répartition automatique équilibrée, qui ne peut pas deviner qu'un organisateur
 * veut par exemple qualifier plus de monde d'une poule en particulier. `dir` = -1 (poule précédente
 * dans t.pools) ou +1 (poule suivante). Ajouté en fin d'ordre de la poule cible. Refuse de vider une
 * poule (au moins 1 joueur doit y rester) et refuse hors du statut 'setup'. */
export declare function movePlayerToPool(t: Tournament, playerId: string, poolId: string, dir: number): boolean;
export declare function launch(t: Tournament): void;
/** Classement d'une poule round robin : victoires, puis différence de manches, puis points acquis. */
export declare function poolRRRanking(t: Tournament, pool: Pool): {
    id: string;
    wins: number;
    gd: number;
}[];
/**
 * Point d'entrée unique du lancement, quel que soit le format. Le format survival garde
 * exactement le comportement historique (poules). Les autres formats n'ont pas de poules :
 * le tournoi entier est directement la structure de compétition (bracket, rondes Swiss, parties BR).
 */
/** Formats à phase finale qui acceptent une phase de groupes optionnelle en amont. */
export declare const POOLED_FORMATS: TournamentFormat[];
/** Le tournoi passe-t-il par une phase de groupes ? Survival en a toujours ; les formats à phase
 *  finale en ont une dès que l'organisateur demande plus d'une poule. */
export declare function usesPools(t: Tournament): boolean;
export declare function launchTournament(t: Tournament): void;
export declare function buildBracket(ids: string[]): Bracket;
export declare function propagateBracket(bracket: Bracket): void;
export declare function bracketChampion(bracket: Bracket | null): string | null;
export declare function nextBracketMatch(bracket: Bracket | null): {
    match: BracketMatch;
} | null;
export interface CurrentMatch {
    a: string;
    b: string;
    stage: Stage;
    streak: number;
    matchId?: string;
}
export declare function currentMatch(pool: Pool): CurrentMatch | null;
export declare function reportResult(t: Tournament, poolId: string, winnerId: string, sa?: number, sb?: number, reason?: string): {
    winnerId: string;
    loserId: string;
    pts: number;
    stage: Stage;
} | null;
export declare function allPoolsDone(t: Tournament): boolean;
export declare function qualifiers(t: Tournament): string[];
/** Classement round robin : victoires puis différence de manches puis points. */
export declare function rrRanking(t: Tournament): {
    id: string;
    wins: number;
    gd: number;
}[];
export declare function startFinals(t: Tournament, format?: FinalsFormat): void;
/** Toutes les rencontres de la phase finale, quel que soit le format — pour recherche/affichage générique. */
export declare function allFinalsMatches(t: Tournament): BracketMatch[];
export declare function findFinalsMatch(t: Tournament, matchId: string): BracketMatch | null;
export declare function reportFinals(t: Tournament, matchId: string, winnerId: string, sa?: number, sb?: number, reason?: string): {
    winnerId: string;
    pts: number;
} | null;
/** Classement Swiss courant : victoires puis Buchholz (somme des victoires des adversaires affrontés) puis points. */
export declare function swissStandings(t: Tournament): {
    id: string;
    wins: number;
    buchholz: number;
}[];
/** Rapporte le résultat d'un match Swiss de la ronde en cours ; enchaîne la ronde suivante ou couronne le champion. */
export declare function reportSwiss(t: Tournament, matchId: string, winnerId: string, sa?: number, sb?: number, reason?: string): {
    winnerId: string;
    pts: number;
} | null;
/** Rapporte le classement complet d'une partie Battle Royale (ids du 1er au dernier) ; enchaîne ou couronne le champion après la dernière partie. */
export declare function reportBattleRoyale(t: Tournament, gameId: string, ranking: string[]): {
    ok: boolean;
};
/**
 * Disqualifie un joueur en cours de tournoi : forfait immédiat sur son match en
 * cours (s'il y en a un, poule ou finale — l'adversaire est déclaré vainqueur via
 * la machine à états existante, ce qui fait avancer poule/bracket normalement) et
 * retrait des files d'attente pas encore atteintes (poule Survival, perdants pas
 * encore engagés dans le bracket de repêchage).
 */
export declare function disqualifyPlayer(t: Tournament, playerId: string): {
    ok: boolean;
    reason?: string;
};
export declare function cagnotte(t: Tournament): {
    total: number;
    programmed: number;
    gap: number;
    valid: boolean;
};
/** Ajuste proportionnellement le barème pour tenir dans la cagnotte. Un seul passage peut laisser
 * un léger dépassement résiduel (chaque catégorie a un plancher de 0.25, donc l'arrondi au pas
 * de 0.25 après mise à l'échelle ne garantit pas individuellement le budget) — on répète jusqu'à
 * rentrer dans la cagnotte ou jusqu'à ce qu'un passage supplémentaire ne change plus rien (toutes
 * les catégories réductibles sont au plancher : le dépassement restant vient alors du bonus champion
 * seul, volontairement non rogné). */
export declare function autoFitScoring(t: Tournament): void;
export declare function distributed(t: Tournament): number;
export interface RankRow {
    id: string;
    name: string;
    pts: number;
    wins: number;
    losses: number;
}
export declare function overallRanking(t: Tournament): RankRow[];
export declare function ratings(tournaments: Tournament[]): Record<string, number>;
