import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min, MaxLength, MinLength, IsEmail } from 'class-validator';

export class CreateTournamentDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) game?: string;
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsString() @MaxLength(160) place?: string;
  @IsOptional() @IsString() @MaxLength(40) date?: string;
  @IsOptional() @IsInt() @Min(1) nbPools?: number;
  @IsOptional() @IsInt() @Min(1) pointsPerPlayer?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) players?: string[];
  @IsOptional() @IsString() @MaxLength(300) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) bannerUrl?: string;
  @IsOptional() @IsString() @MaxLength(4000) rules?: string;
  @IsOptional() @IsString() @MaxLength(400) prize?: string;
  // Tournoi par équipes (2 à 8 joueurs par équipe) — fixé à la création. Absent = tournoi individuel.
  @IsOptional() @IsInt() @Min(2) @Max(8) teamSize?: number;
  // Nombre maximum de participants (0 ou absent = illimité).
  @IsOptional() @IsInt() @Min(0) @Max(2048) maxPlayers?: number;
  @IsOptional() @IsInt() @Min(0) entryFeeXof?: number;
  @IsOptional() @IsBoolean() givesLoyaltyPoint?: boolean;
  @IsOptional() @IsIn(['AMATEUR', 'ELITE']) tier?: 'AMATEUR' | 'ELITE';
  // Événement auquel rattacher ce tournoi (l'appelant doit pouvoir gérer cet événement).
  @IsOptional() @IsString() @MaxLength(60) eventId?: string;
  // Barème de points (facultatif — valeurs par défaut du moteur sinon).
  @IsOptional() @IsNumber() @Min(0.25) survWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) loserWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) poolFinalWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) finalsWin?: number;
  @IsOptional() @IsNumber() @Min(0) championBonus?: number;
  // Bonus "striker" — série de streakLength victoires d'affilée dans une poule (0 pour désactiver).
  @IsOptional() @IsNumber() @Min(0) streakBonus?: number;
  // Longueur de la série qui déclenche le bonus striker — 3 OU 5 victoires d'affilée, un seul palier
  // actif par tournoi (pas les deux en même temps).
  @IsOptional() @IsIn([3, 5]) streakLength?: 3 | 5;
  // Mode de la phase finale (Survival uniquement) — fixé dès la création pour que le budget de
  // cagnotte ci-dessus (finalsWin × nb de matchs) soit calculé pour le bon format dès le départ.
  @IsOptional() @IsIn(['single', 'double', 'roundrobin', 'survival']) finalsFormat?: 'single' | 'double' | 'roundrobin' | 'survival';
  // Mode des poules : 'survival' (Survival), 'roundrobin', ou le bracket du format principal — 'double' (mini-bracket double élim par poule) / 'single' (mini-bracket à élimination directe par poule).
  @IsOptional() @IsIn(['survival', 'double', 'single', 'roundrobin']) poolFormat?: 'survival' | 'double' | 'single' | 'roundrobin';
  // Nombre de qualifiés par poule pour la phase finale, quel que soit le mode de poule : sa seule
  // vraie limite est l'effectif de la poule, appliqué par le moteur (voir Engine.poolQualified).
  // Le plafond ci-dessous n'est qu'un garde-fou anti-abus (payload absurde), pas une limite produit.
  @IsOptional() @IsInt() @Min(1) @Max(500) qualifyPerPool?: number;
  // Format de manche appliqué à tous les matchs du tournoi (poules et phase finale) — 'bo' (Best of,
  // matchValue impair parmi 1/3/5/7/9, premier à la majorité) ou 'ft' (First To, premier à matchValue).
  // Purement informatif pour le moteur (voir Engine.MatchFormat) : n'affecte pas la structure du
  // bracket, seulement l'étiquette affichée et le seuil de victoire suggéré.
  @IsOptional() @IsIn(['bo', 'ft']) matchMode?: 'bo' | 'ft';
  @IsOptional() @IsInt() @Min(1) @Max(99) matchValue?: number;
  // Départage des égalités de victoires par différence de buts/manches (Round Robin — poules et
  // phase finale). Activé par défaut ; désactivé, seules les victoires comptent.
  @IsOptional() @IsBoolean() countGoalDiff?: boolean;
  // Critères de départage, DANS L'ORDRE d'application (h2h confrontation directe, gd différence, gf marqués, ga encaissés).
  // Liste vide : seules les victoires comptent. Remplace countGoalDiff (gardé pour compatibilité).
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(['h2h', 'gd', 'gf', 'ga', 'wins'], { each: true }) tiebreakers?: ('h2h' | 'gd' | 'gf' | 'ga' | 'wins')[];
  // Règles de championnat / Swiss (hors Survival), modifiables avant le lancement.
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueWin?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueDraw?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueLoss?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueBye?: number;
  @IsOptional() @IsIn(['points', 'wins', 'games', 'gamePct', 'gameDiff', 'scored', 'pointDiff']) rankBy?: 'points' | 'wins' | 'games' | 'gamePct' | 'gameDiff' | 'scored' | 'pointDiff';
  @IsOptional() @IsInt() @Min(1) @Max(3) rrLegs?: number;
  @IsOptional() @IsIn(['sets', 'aggregate']) setsMode?: 'sets' | 'aggregate';
  // Battle Royale uniquement : palier de points par classement de partie (index 0 = 1er) et bonus par
  // élimination — réglables avant lancement, valeurs par défaut du moteur sinon (Engine.DEFAULT_BR_POINTS / 1).
  @IsOptional() @IsArray() @IsNumber({}, { each: true }) brPointsTable?: number[];
  @IsOptional() @IsNumber() @Min(0) brKillPoints?: number;
  @IsOptional() @IsInt() @Min(0) @Max(64) brHeatSize?: number;
  @IsOptional() @IsIn(['points', 'best', 'total']) brRank?: 'points' | 'best' | 'total';
  @IsOptional() @IsIn([3, 8, 16]) placementMax?: number;
}

export class UpdateTournamentDto {
  @IsOptional() @IsBoolean() allowPlayerReports?: boolean;
  // Une question par entrée ; un « * » final la rend obligatoire.
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(160, { each: true }) questions?: string[];
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) game?: string;
  @IsOptional() @IsString() @MaxLength(40) date?: string;
  @IsOptional() @IsString() @MaxLength(160) place?: string;
  @IsOptional() @IsString() @MaxLength(300) imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) bannerUrl?: string;
  @IsOptional() @IsString() @MaxLength(4000) rules?: string;
  @IsOptional() @IsString() @MaxLength(400) prize?: string;
  @IsOptional() @IsInt() @Min(0) entryFeeXof?: number;
  @IsOptional() @IsBoolean() givesLoyaltyPoint?: boolean;
  @IsOptional() @IsIn(['AMATEUR', 'ELITE']) tier?: 'AMATEUR' | 'ELITE';
  @IsOptional() @IsInt() @Min(0) @Max(2048) maxPlayers?: number;
  // Modifiables uniquement tant que le tournoi n'est pas lancé (voir TournamentsService.update).
  @IsOptional() @IsInt() @Min(1) nbPools?: number;
  @IsOptional() @IsInt() @Min(1) pointsPerPlayer?: number;
  @IsOptional() @IsIn(['single', 'double', 'roundrobin', 'survival']) finalsFormat?: 'single' | 'double' | 'roundrobin' | 'survival';
  @IsOptional() @IsIn(['survival', 'double', 'single', 'roundrobin']) poolFormat?: 'survival' | 'double' | 'single' | 'roundrobin';
  // Nombre de qualifiés par poule pour la phase finale (voir CreateTournamentDto) : borné par
  // l'effectif de la poule, pas par son mode.
  @IsOptional() @IsInt() @Min(1) @Max(500) qualifyPerPool?: number;
  @IsOptional() @IsIn([3, 5]) streakLength?: 3 | 5;
  // Format de manche (voir CreateTournamentDto) — modifiable tant que le tournoi n'est pas lancé.
  @IsOptional() @IsIn(['bo', 'ft']) matchMode?: 'bo' | 'ft';
  @IsOptional() @IsInt() @Min(1) @Max(99) matchValue?: number;
  @IsOptional() @IsBoolean() countGoalDiff?: boolean;
  // Critères de départage, DANS L'ORDRE d'application (h2h confrontation directe, gd différence, gf marqués, ga encaissés).
  // Liste vide : seules les victoires comptent. Remplace countGoalDiff (gardé pour compatibilité).
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(['h2h', 'gd', 'gf', 'ga', 'wins'], { each: true }) tiebreakers?: ('h2h' | 'gd' | 'gf' | 'ga' | 'wins')[];
  // Règles de championnat / Swiss (hors Survival), modifiables avant le lancement.
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueWin?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueDraw?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueLoss?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(999) leagueBye?: number;
  @IsOptional() @IsIn(['points', 'wins', 'games', 'gamePct', 'gameDiff', 'scored', 'pointDiff']) rankBy?: 'points' | 'wins' | 'games' | 'gamePct' | 'gameDiff' | 'scored' | 'pointDiff';
  @IsOptional() @IsInt() @Min(1) @Max(3) rrLegs?: number;
  @IsOptional() @IsIn(['sets', 'aggregate']) setsMode?: 'sets' | 'aggregate';
  // Changement de format — uniquement tant que le tournoi est en brouillon (aucun match joué) : le
  // moteur est reconstruit à neuf pour le nouveau format, en conservant les participants déjà saisis.
  @IsOptional() @IsIn(['SURVIVAL', 'SINGLE_ELIM', 'DOUBLE_ELIM', 'SWISS', 'ROUND_ROBIN', 'BATTLE_ROYALE']) format?: string;
  // Barème (facultatif, repris tel quel si applicable au nouveau format — voir TournamentsService.update).
  @IsOptional() @IsNumber() @Min(0.25) survWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) loserWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) poolFinalWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) finalsWin?: number;
  @IsOptional() @IsNumber() @Min(0) championBonus?: number;
  @IsOptional() @IsNumber() @Min(0) streakBonus?: number;
  // Battle Royale uniquement — voir CreateTournamentDto. Modifiable comme countGoalDiff/matchMode :
  // uniquement tant que le tournoi n'est pas lancé (TournamentsService.update).
  @IsOptional() @IsArray() @IsNumber({}, { each: true }) brPointsTable?: number[];
  @IsOptional() @IsNumber() @Min(0) brKillPoints?: number;
  @IsOptional() @IsInt() @Min(0) @Max(64) brHeatSize?: number;
  @IsOptional() @IsIn(['points', 'best', 'total']) brRank?: 'points' | 'best' | 'total';
  @IsOptional() @IsIn([3, 8, 16]) placementMax?: number;
}

export class AddPlayerDto {
  @IsString() @MaxLength(80) name!: string;
  // Tournoi par équipes : les joueurs de l'équipe ajoutée.
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) members?: string[];
}

export class TeamMembersDto {
  @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) members!: string[];
}

export class ClubDto {
  @IsString() @MaxLength(80) club!: string;
}

export class AdjustDto {
  @IsNumber() delta!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class ScoringDto {
  @IsIn(['survWin', 'loserWin', 'poolFinalWin', 'finalsWin', 'championBonus', 'streakBonus']) key!: string;
  @IsNumber() value!: number;
}

export class MoveOrderDto {
  @IsInt() @Min(0) index!: number;
  @IsIn([-1, 1]) dir!: number;
}

export class RosterMoveDto {
  @IsString() playerId!: string;
  @IsIn([-1, 1]) dir!: number;
}

// Rééquilibrage manuel de l'effectif des poules (avant lancement) : déplace un joueur vers la poule
// adjacente — la répartition automatique équilibrée ne peut pas deviner qu'on veut, par exemple,
// qualifier plus de monde d'une poule en particulier (voir Engine.movePlayerToPool).
export class PoolPlayerMoveDto {
  @IsString() playerId!: string;
  @IsIn([-1, 1]) dir!: number;
}

// Endpoint dédié (même principe que /scoring) pour ajuster "Qualifiés par poule" directement depuis
// le panneau "Répartition des poules" une fois les poules réellement constituées — sans repasser par
// l'assistant complet. Le plafond ci-dessous est un garde-fou anti-abus, pas une limite produit (voir
// Engine.clampQualifyPerPool).
export class QualifyPerPoolDto {
  @IsInt() @Min(1) @Max(500) value!: number;
}

export class StartFinalsDto {
  @IsOptional() @IsIn(['single', 'double', 'roundrobin', 'survival']) format?: 'single' | 'double' | 'roundrobin' | 'survival';
}

export class ReportDto {
  @IsOptional() @IsString() poolId?: string;
  @IsOptional() @IsString() matchId?: string;
  @IsOptional() @IsString() winnerId?: string;
  @IsOptional() @IsInt() @Min(0) scoreA?: number;
  @IsOptional() @IsInt() @Min(0) scoreB?: number;
  // Plusieurs sets : [[a, b], …] — le moteur en déduit le score et le vainqueur (voir Engine.scoreFromSets).
  @IsOptional() @IsArray() @ArrayMaxSize(15) sets?: number[][];
}

// Départage manuel : monte (+1) ou descend (-1) un joueur parmi ceux à égalité parfaite.
export class TiebreakDto {
  @IsString() playerId!: string;
  @IsInt() @Min(-1) @Max(1) delta!: number;
}

// Corrige un match DÉJÀ joué, identifié par l'id de son entrée de journal (voir Engine.correctResult)
// — remplace le tap "cliquer un nom = valider" par une correction ciblée, cascade comprise.
export class CorrectResultDto {
  @IsString() logId!: string;
  @IsString() winnerId!: string;
  @IsOptional() @IsInt() @Min(0) scoreA?: number;
  @IsOptional() @IsInt() @Min(0) scoreB?: number;
}

// Pointage de présence : soit le contenu d'un QR code scanné / le code court du billet (code), soit l'inscription
// visée directement depuis la liste (registrationId). present=false annule un pointage fait par erreur.
export class CheckinDto {
  @IsOptional() @IsString() @MaxLength(300) code?: string;
  @IsOptional() @IsString() @MaxLength(60) registrationId?: string;
  @IsOptional() @IsBoolean() present?: boolean;
}

// Poste/table assigné à un match en cours (voir TournamentsService.setStation) — key = activeKey côté web.
export class StationDto {
  @IsString() @MaxLength(60) key!: string;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
}

// Match "à l'antenne" (voir TournamentsService.setStreamMatch) — key = activeKey côté web.
export class StreamMatchDto {
  @IsString() @MaxLength(60) key!: string;
  @IsBoolean() on!: boolean;
}

export class MatchStartDto {
  @IsString() @MaxLength(60) key!: string;
  @IsBoolean() on!: boolean;
}

export class MatchMinutesDto {
  @IsOptional() @IsInt() @Min(0) @Max(240) minutes?: number;
}

export class PredictDto {
  @IsString() @MaxLength(60) matchKey!: string;
  @IsString() @MaxLength(80) pick!: string;
}

export class NotifyMatchDto {
  @IsString() @MaxLength(60) key!: string;
}

export class RegisterDto {
  // Tournoi par équipes : nom de l'équipe et ses joueurs (le capitaine inscrit toute l'équipe).
  @IsOptional() @IsString() @MaxLength(40) teamName?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) members?: string[];
  @IsOptional() @IsString() @MaxLength(40) paymentMethod?: string;
  @IsOptional() @IsInt() @Min(0) pointsToRedeem?: number;
  // Réponses aux questions du tournoi, dans l'ordre des questions.
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(300, { each: true }) answers?: string[];
}

// Score envoyé par un joueur (ou signalement d'un problème, avec « note » seule).
export class PlayerReportDto {
  @IsString() @MaxLength(80) matchKey!: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) scoreA?: number;
  @IsOptional() @IsInt() @Min(0) @Max(999) scoreB?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ReviewReportDto {
  @IsIn(['accept', 'reject']) decision!: 'accept' | 'reject';
}

export class BattleRoyaleReportDto {
  @IsString() gameId!: string;
  @IsArray() @IsString({ each: true }) ranking!: string[];
  // Nombre d'éliminations par joueur (clé = id joueur) — optionnel, validé plus finement côté moteur
  // (Engine.reportBattleRoyale ignore silencieusement une valeur non numérique ou ≤ 0).
  @IsOptional() @IsObject() kills?: Record<string, number>;
  // Course : temps par joueur, en secondes.
  @IsOptional() @IsObject() times?: Record<string, number>;
}

export class AnnouncementDto {
  @IsString() @MinLength(2) @MaxLength(600) text!: string;
}

export class CoAdminDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide.' }) email!: string;
}

// Heure prévue d'un match (ISO) ; vide = retirer.
export class MatchTimeDto {
  @IsString() @MaxLength(80) key!: string;
  @IsOptional() @IsString() @MaxLength(40) at?: string;
}
