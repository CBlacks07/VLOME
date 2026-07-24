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
}
export interface BracketMatch {
    id: string;
    a: string | null;
    b: string | null;
    winner: string | null;
    bye: boolean;
}
export interface Bracket {
    rounds: BracketMatch[][];
}
export type PoolPhase = 'pending' | 'survival' | 'losers' | 'poolFinal' | 'done';
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
}
export type Stage = 'survival' | 'losers' | 'poolFinal' | 'finals' | 'championBonus' | 'adjust';
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
    players: Player[];
    scoring: Scoring;
    pools: Pool[];
    status: Status;
    log: LogEntry[];
    points: Record<string, number>;
    finals: Bracket | null;
    champion: string | null;
}
export declare function uid(): string;
export declare function newTournament(cfg?: Partial<Tournament>): Tournament;
export declare function parseEntry(raw: string): {
    name: string;
    club: string;
};
export declare function setPlayers(t: Tournament, names: string[]): void;
export declare function playerName(t: Tournament, id: string | null): string;
export declare function scoringBounds(key: keyof Scoring): {
    min: number;
    max: number;
};
export declare function balancedSizes(nPlayers: number, nbPools: number): number[];
export declare function distributePools(t: Tournament): void;
export declare function launch(t: Tournament): void;
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
export declare function reportResult(t: Tournament, poolId: string, winnerId: string, sa?: number, sb?: number): {
    winnerId: string;
    loserId: string;
    pts: number;
    stage: Stage;
} | null;
export declare function allPoolsDone(t: Tournament): boolean;
export declare function qualifiers(t: Tournament): string[];
export declare function startFinals(t: Tournament): void;
export declare function reportFinals(t: Tournament, matchId: string, winnerId: string, sa?: number, sb?: number): {
    winnerId: string;
    pts: number;
} | null;
export declare function cagnotte(t: Tournament): {
    total: number;
    programmed: number;
    gap: number;
    valid: boolean;
};
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
