import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreateTournamentDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() game?: string;
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsString() place?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsInt() @Min(1) nbPools?: number;
  @IsOptional() @IsInt() @Min(1) pointsPerPlayer?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) players?: string[];
  @IsOptional() @IsString() @MaxLength(300) imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) entryFeeXof?: number;
  @IsOptional() @IsBoolean() givesLoyaltyPoint?: boolean;
  // Barème de points (facultatif — valeurs par défaut du moteur sinon).
  @IsOptional() @IsNumber() @Min(0.25) survWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) loserWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) poolFinalWin?: number;
  @IsOptional() @IsNumber() @Min(0.25) finalsWin?: number;
  @IsOptional() @IsNumber() @Min(0) championBonus?: number;
}

export class UpdateTournamentDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() game?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() place?: string;
  @IsOptional() @IsString() @MaxLength(300) imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) entryFeeXof?: number;
  @IsOptional() @IsBoolean() givesLoyaltyPoint?: boolean;
  // Modifiables uniquement tant que le tournoi n'est pas lancé (voir TournamentsService.update).
  @IsOptional() @IsInt() @Min(1) nbPools?: number;
  @IsOptional() @IsInt() @Min(1) pointsPerPlayer?: number;
}

export class AddPlayerDto {
  @IsString() @MaxLength(80) name!: string;
}

export class ClubDto {
  @IsString() @MaxLength(80) club!: string;
}

export class AdjustDto {
  @IsNumber() delta!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class ScoringDto {
  @IsIn(['survWin', 'loserWin', 'poolFinalWin', 'finalsWin', 'championBonus']) key!: string;
  @IsNumber() value!: number;
}

export class MoveOrderDto {
  @IsInt() @Min(0) index!: number;
  @IsIn([-1, 1]) dir!: number;
}

export class StartFinalsDto {
  @IsOptional() @IsIn(['single', 'double', 'roundrobin']) format?: 'single' | 'double' | 'roundrobin';
}

export class ReportDto {
  @IsOptional() @IsString() poolId?: string;
  @IsOptional() @IsString() matchId?: string;
  @IsOptional() @IsString() winnerId?: string;
  @IsOptional() @IsInt() @Min(0) scoreA?: number;
  @IsOptional() @IsInt() @Min(0) scoreB?: number;
}

export class RegisterDto {
  @IsOptional() @IsString() @MaxLength(40) paymentMethod?: string;
  @IsOptional() @IsInt() @Min(0) pointsToRedeem?: number;
}

export class BattleRoyaleReportDto {
  @IsString() gameId!: string;
  @IsArray() @IsString({ each: true }) ranking!: string[];
}
