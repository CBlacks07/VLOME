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
    sets?: SetScore[];
    leg?: number;
}
export interface Bracket {
    rounds: BracketMatch[][];
    /** Petite finale (3e place), entre les deux perdants de demi-finale — seulement s'il existe une
     *  vraie demi-finale (4 participants ou plus dans l'arbre). null tant qu'elle n'est pas jouable,
     *  et pour les arbres trop petits pour en avoir une (2-3 participants). */
    thirdPlace: BracketMatch | null;
}
export type PoolPhase = 'pending' | 'survival' | 'losers' | 'poolFinal' | 'double' | 'single' | 'roundrobin' | 'done';
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
/** Mode de poule. Hors Survival : 'roundrobin', ou le bracket du format principal — 'double' (chaque poule est un
 *  mini-bracket double élimination) / 'single' (chaque poule est un mini-bracket à élimination directe). */
export type PoolFormat = 'survival' | 'double' | 'single' | 'roundrobin';
export declare const DEFAULT_QUALIFY_PER_POOL = 2;
/** Borne le nombre de qualifiés par poule (au moins 1, défaut 2). Aucun plafond selon le mode de
 * poule : Round Robin, Survival classique et Double élimination produisent tous un classement
 * complet de la poule (voir poolFinishOrder pour les deux derniers) — la seule vraie limite est
 * l'effectif de chaque poule, que chaque appelant applique déjà (slice()/Math.min() sans
 * dépassement). */
export declare function clampQualifyPerPool(v?: number): number;
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
    /** Bracket à élimination directe de la poule — seulement si le tournoi utilise poolFormat 'single'. */
    sbracket: Bracket | null;
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
    /** Détail des sets quand le match en comptait plusieurs. */
    sets?: SetScore[];
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
    matchId?: string;
}
export type Status = 'setup' | 'live' | 'finished';
/** Score d'un set : [côté A, côté B]. */
export type SetScore = [number, number];
/** Points d'un classement de championnat / Swiss (hors Survival). */
export interface LeaguePoints {
    win: number;
    draw: number;
    loss: number;
    bye: number;
}
export declare const DEFAULT_LEAGUE_POINTS: LeaguePoints;
/** Critère principal d'un championnat : points, victoires, manches gagnées, % de manches, différence de manches,
 *  points (buts) marqués, différence de points. */
export type RankBy = 'points' | 'wins' | 'games' | 'gamePct' | 'gameDiff' | 'scored' | 'pointDiff';
export declare const RANK_BY: RankBy[];
/** Comment plusieurs sets désignent le vainqueur : le plus de sets gagnés, ou le total cumulé (aller-retour). */
export type SetsMode = 'sets' | 'aggregate';
export type FinalsFormat = 'single' | 'double' | 'roundrobin' | 'survival';
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
    seeded?: boolean;
}
/** Une ronde = les matchs de cette ronde (appariements). Les rondes précédentes sont conservées pour l'historique/l'affiche. */
export interface SwissFinals {
    format: 'swiss';
    rounds: BracketMatch[][];
    roundCount: number;
}
/** kills : nombre d'éliminations par joueur dans cette partie (rempli avec le classement, voir
 * reportBattleRoyale) — absent/vide tant que la partie n'est pas jouée, ou pour d'anciennes parties
 * enregistrées avant l'ajout du bonus d'élimination. */
export interface BRGame {
    id: string;
    ranking: string[] | null;
    kills?: Record<string, number> | null;
}
export interface BattleRoyaleFinals {
    format: 'battle_royale';
    games: BRGame[];
    pointsTable: number[];
    killPoints: number;
}
/** Phase finale en mode Survival (poules en Round Robin uniquement — voir startFinalsSurvivalPool) :
 *  simple marqueur, les données réelles (joueurs, matchs, classement) vivent dans t.pools[0], une
 *  "grande poule" réunissant tous les qualifiés, jouée et rapportée exactement comme n'importe
 *  quelle poule (reportResult, poolId). Son top1, une fois done, devient directement le champion. */
export interface SurvivalFinals {
    format: 'survival';
}
export type Finals = SingleFinals | DoubleFinals | RoundRobinFinals | SwissFinals | BattleRoyaleFinals | SurvivalFinals;
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
     *  l'effectif de la plus petite poule, quel que soit le mode de poule (voir poolQualified). Absent
     *  sur d'anciennes données : traiter comme 2 (top1 + top2, comportement historique). */
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
    /** Critères de départage des égalités de victoires (Round Robin — poules et phase finale), DANS L'ORDRE où ils
     *  s'appliquent : 'h2h' confrontation directe, 'gd' différence de buts/manches, 'gf' buts/manches marqués,
     *  'ga' buts/manches encaissés (moins = mieux). Liste vide : seules les victoires comptent. Absent sur d'anciennes
     *  données : déduit de countGoalDiff (voir effectiveTiebreakers). */
    tiebreakers?: Tiebreaker[];
    /** Battle Royale (format 'battle_royale' uniquement) : barème réglable avant lancement — palier de
     *  points par classement de partie (index 0 = 1er) et bonus par élimination. Consommés une seule
     *  fois, au lancement, dans finals.pointsTable/killPoints (voir launchTournament) — comme
     *  countGoalDiff/matchFormat, plus modifiables une fois le tournoi lancé (poules déjà constituées,
     *  parties déjà jouées). Absents sur d'anciennes données : traiter comme DEFAULT_BR_POINTS / 1. */
    brPointsTable?: number[];
    brKillPoints?: number;
    /** Barème de championnat et de Swiss (hors Survival) — absent : 3 / 1 / 0, exempt = victoire. */
    league?: LeaguePoints;
    /** Critère principal du championnat — absent : les points. */
    rankBy?: RankBy;
    /** Nombre de fois que chacun affronte chacun en championnat (1 = aller simple). */
    rrLegs?: number;
    setsMode?: SetsMode;
    /** Départage manuel posé par l'organisateur : à égalité parfaite, la plus grande valeur passe devant. */
    manualOrder?: Record<string, number>;
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
/** Critères de départage disponibles (voir Tournament.tiebreakers). */
export type Tiebreaker = 'h2h' | 'gd' | 'gf' | 'ga' | 'wins';
export declare const TIEBREAKERS: Tiebreaker[];
/** Nettoie une liste de critères reçue de l'extérieur : valeurs connues, sans doublon, ordre conservé. undefined si ce n'est pas un tableau. */
export declare function normalizeTiebreakers(v: unknown): Tiebreaker[] | undefined;
/** Critères réellement appliqués : la liste choisie, sinon (anciennes données) le comportement historique selon countGoalDiff. */
export declare function effectiveTiebreakers(t: Pick<Tournament, 'countGoalDiff' | 'tiebreakers'>): Tiebreaker[];
/** Vrai si au moins un critère chiffré (écart/marqués/encaissés) est actif — pilote l'affichage de la colonne « Diff. ». */
export declare function usesScoreTiebreak(tbs: Tiebreaker[]): boolean;
export declare function uid(): string;
export declare function newTournament(cfg?: Partial<Tournament>): Tournament;
export declare function clampLegs(v?: number): number;
export declare function normalizeLeaguePoints(v?: Partial<LeaguePoints> | null): LeaguePoints;
export declare function leaguePoints(t: Tournament): LeaguePoints;
/** Nettoie des sets saisis (au plus 15, scores entiers positifs). undefined s'il n'y a rien d'exploitable. */
export declare function normalizeSets(v: unknown): SetScore[] | undefined;
/** Score d'un match à partir de ses sets : un seul set = son score ; plusieurs = sets gagnés, ou total cumulé. */
export declare function scoreFromSets(t: Tournament, sets: SetScore[]): [number, number];
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
/** Corrige le résultat d'un match DÉJÀ joué, identifié par l'id de son entrée de journal (t.log) —
 *  score et/ou vainqueur erronés saisis par erreur. Contrairement à undo() (annule seulement la toute
 *  dernière action), une correction peut viser n'importe quel match du journal : elle restaure le
 *  tournoi dans l'état exact d'avant CE match précis (via la pile d'annulation), puis y réapplique le
 *  résultat corrigé à sa place. Tout ce qui s'est joué après ce match dans l'ancien déroulé disparaît
 *  avec — remis à "à rejouer", en cascade, sans logique de dépendances à maintenir par format : la
 *  pile d'annulation capture déjà l'état complet, quel que soit le format.
 *  Repose sur la même pile que undo() (25 actions au maximum) : au-delà, retourne null (trop ancien).
 *  L'appelant doit remplacer sa référence par la valeur retournée, comme pour undo(). */
export declare function correctResult(t: Tournament, logEntryId: string, newWinnerId: string, newSa?: number, newSb?: number): Tournament | null;
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
export interface LeagueRow {
    id: string;
    wins: number;
    draws: number;
    losses: number;
    played: number;
    gd: number;
    gf: number;
    gamesWon: number;
    gamesLost: number;
    pts: number;
}
/** Classement d'une poule round robin : victoires, puis différence de manches, puis points acquis.
 *  "played" (matchs joués) et la défaite qui s'en déduit (played - wins) sont exposés pour un vrai
 *  tableau de championnat (# / Équipe / J / G / P / Pts) plutôt qu'une seule colonne victoires. */
export declare function poolRRRanking(t: Tournament, pool: Pool): LeagueRow[];
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
/** @param compact Si vrai, personne n'est exempt au 1er tour tant que l'effectif de CE tour est pair
 *  — appariement séquentiel (1v2, 3v4…), un seul exempt tournant au tour suivant dès qu'un effectif
 *  intermédiaire devient impair (jamais au 1er tour si l'effectif de départ est pair). Sinon (défaut),
 *  comportement historique : complété à la puissance de 2 supérieure par placement en tête de série
 *  (seedSlots), les exempts nécessaires concentrés au 1er tour. Utilisé pour le format principal
 *  Bracket simple (launchTournament/startFinals) ET pour le bracket de repêchage Survival
 *  (pool.lBracket, voir startLosers) : dans les deux cas un maximum de joueurs joue dès le 1er tour. */
export declare function buildBracket(ids: string[], compact?: boolean): Bracket;
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
/** « Vainqueur » d'un match nul : le match est joué, personne ne l'a gagné. */
export declare const DRAW = "__draw__";
/** Points d'un classement de championnat (hors barème Survival). */
export declare const LEAGUE_WIN = 3;
export declare const LEAGUE_DRAW = 1;
/** Le nul n'existe que dans les formats à points (championnat : poule ou phase finale en Round Robin), jamais dans un arbre
 *  à élimination ni en Swiss, et jamais en Survival (son barème récompense uniquement des victoires). */
export declare function drawsAllowed(t: Tournament, poolId: string): boolean;
export declare function reportResult(t: Tournament, poolId: string, winnerId: string, sa?: number, sb?: number, reason?: string, sets?: SetScore[]): {
    winnerId: string;
    loserId: string;
    pts: number;
    stage: Stage;
} | null;
export declare function allPoolsDone(t: Tournament): boolean;
/** Ordre d'arrivée complet d'une poule Survival classique ou Double élimination terminée : les deux
 *  finalistes d'abord (top1 puis top2, désignés par la finale de poule / la grande finale), puis tous
 *  les autres par points gagnés DANS cette poule (journal : survWin/loserWin/poolFinalWin, bonus
 *  striker compris — jamais t.points, qui continue de bouger en phase finale), puis victoires, puis
 *  ordre de passage. Même critère que le tableau de classement affiché (poolRanking côté API) : on ne
 *  voit pas un ordre et n'en qualifie pas un autre. Sert à qualifier plus de deux joueurs par poule
 *  dans ces deux modes (le Round Robin a son propre classement, voir poolRRRanking). */
export declare function poolFinishOrder(t: Tournament, pool: Pool): string[];
/** Qualifiés d'une poule pour la phase finale, dans l'ordre de classement, au plus qualifyPerPool
 *  (borné par l'effectif de la poule). Round Robin : liste posée à la fin de la poule
 *  (checkPoolRoundRobinDone). Survival classique / Double élimination : dérivée à la demande de
 *  l'ordre d'arrivée (poolFinishOrder), donc valable aussi pour d'anciennes poules déjà terminées.
 *  Un joueur disqualifié est passé et remplacé par le suivant du classement. */
export declare function poolQualified(t: Tournament, pool: Pool): string[];
export declare function qualifiers(t: Tournament): string[];
/** Comme qualifiers(), mais scindé en deux moitiés — voir startFinals (finalsFormat 'double') et
 *  buildDoubleElimSeeded : les mieux classés de chaque poule ("top", moitié supérieure arrondie au-
 *  dessus si effectif impair) entrent dans le bracket vainqueurs comme d'habitude ; les moins bien
 *  classés ("bottom") entrent DIRECTEMENT dans le bracket perdants, comme s'ils avaient déjà perdu
 *  une fois — évite de rejouer d'entrée les confrontations déjà vues en poule, et récompense la
 *  meilleure moitié de poule par un vrai avantage (une défaite de plus en réserve) plutôt qu'un
 *  simple ordre de tête de série. Chaque moitié est ordonnée poule par poule, rang par rang (A,B,C,D,
 *  A,B,C,D…) avant le placement en tête de série (seedSlots, dans buildDoubleElimSeeded) : deux
 *  qualifiés d'une même poule ne peuvent donc jamais se retrouver l'un contre l'autre au 1er tour de
 *  leur moitié. */
export declare function qualifiersSplit(t: Tournament): {
    top: string[];
    bottom: string[];
};
/** Classement round robin : victoires, puis les critères de départage choisis (voir Tournament.tiebreakers), puis points.
 *  La confrontation directe ne tranche qu'entre deux joueurs qui se sont affrontés — un blocage à 3+ retombe sur le
 *  critère suivant, comme la plupart des règlements amateurs qui n'ouvrent pas de mini-poule. */
export declare function rrRanking(t: Tournament): LeagueRow[];
/** Lance un tournoi à poules en mode "double élimination fusionné" (voir groupedDoubleElimIds) :
 *  t.finals EST le bracket, dès le lancement — pas de phase de poules distincte à faire aboutir
 *  d'abord (t.pools ne sert plus qu'à la prévisualisation/au rééquilibrage avant lancement). */
export declare function launchGroupedDoubleElim(t: Tournament): void;
export declare function startFinals(t: Tournament, format?: FinalsFormat): void;
/** Toutes les rencontres de la phase finale, quel que soit le format — pour recherche/affichage générique. */
export declare function allFinalsMatches(t: Tournament): BracketMatch[];
export declare function findFinalsMatch(t: Tournament, matchId: string): BracketMatch | null;
export declare function reportFinals(t: Tournament, matchId: string, winnerId: string, sa?: number, sb?: number, reason?: string, sets?: SetScore[]): {
    winnerId: string;
    pts: number;
} | null;
/** Classement Swiss courant : victoires puis Buchholz (somme des victoires des adversaires affrontés) puis points. */
export declare function swissStandings(t: Tournament): {
    id: string;
    wins: number;
    draws: number;
    losses: number;
    pts: number;
    buchholz: number;
}[];
/** Rapporte le résultat d'un match Swiss de la ronde en cours ; enchaîne la ronde suivante ou couronne le champion. */
export declare function reportSwiss(t: Tournament, matchId: string, winnerId: string, sa?: number, sb?: number, reason?: string, sets?: SetScore[]): {
    winnerId: string;
    pts: number;
} | null;
/** Rapporte le classement complet d'une partie Battle Royale (ids du 1er au dernier), et
 * optionnellement le nombre d'éliminations par joueur (kills[id]) ; chaque joueur marque les points
 * de son palier de classement (f.pointsTable) PLUS f.killPoints par élimination. Enchaîne ou couronne
 * le champion après la dernière partie. */
export declare function reportBattleRoyale(t: Tournament, gameId: string, ranking: string[], kills?: Record<string, number>): {
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
/** `simulatedPlayers` : effectif utilisé à la place de `t.players.length` quand celui-ci est nul —
 * sert uniquement à prévisualiser/ajuster la cagnotte avant les premières inscriptions (voir le champ
 * « Nombre de participants (simulation) » côté web) ; ignoré dès qu'il y a au moins un vrai participant. */
export declare function cagnotte(t: Tournament, simulatedPlayers?: number): {
    total: number;
    programmed: number;
    gap: number;
    valid: boolean;
};
/** Ajuste proportionnellement le barème pour tenir dans la cagnotte, en l'utilisant au maximum.
 * Un seul passage ne suffit pas : chaque catégorie a un plancher de 0.25, donc l'arrondi au pas de
 * 0.25 après mise à l'échelle ne colle ni au budget en cas de dépassement (dépassement résiduel —
 * il vient alors du bonus champion seul, volontairement non rogné), ni à son plein emploi en cas de
 * sous-utilisation (chaque passage ne rapproche le barème du budget que d'un cran de 0.25 à la
 * fois). On répète donc jusqu'à ce qu'un passage supplémentaire ne change plus rien — plancher
 * atteint en cas de dépassement, ou barème déjà au plus près du budget en cas de redistribution —,
 * plutôt que de s'arrêter dès le premier passage valide : une redistribution qui laisse un large
 * reliquat après un seul clic ne serait pas la redistribution « intelligente » promise à
 * l'organisateur. */
export declare function autoFitScoring(t: Tournament, simulatedPlayers?: number): void;
export declare function distributed(t: Tournament): number;
/** Départage manuel : fait monter ou descendre un joueur parmi ceux qui sont à égalité parfaite avec lui. */
export declare function adjustManualOrder(t: Tournament, playerId: string, delta: number): boolean;
export interface RankRow {
    id: string;
    name: string;
    pts: number;
    wins: number;
    losses: number;
}
export declare function overallRanking(t: Tournament): RankRow[];
/** Places finales d'un tournoi, de la 1re à la dernière : chaque groupe réunit les joueurs à la même place (éliminés au même
 *  tour). Les éliminés en poules viennent après les finalistes, selon leur rang dans leur poule. */
export declare function finalPlacements(t: Tournament): string[][];
/** Points attribués selon la place finale, hors Survival. */
export declare function placementPoints(rank: number): number;
/** Ce qu'un tournoi rapporte au classement du site, par joueur. Survival : les points du barème, au fil de l'eau. Autres
 *  formats : des points selon la place, une fois le tournoi terminé, pour ceux qui ont réellement joué. */
export declare function rankingPoints(t: Tournament): Record<string, number>;
export declare function ratings(tournaments: Tournament[]): Record<string, number>;
