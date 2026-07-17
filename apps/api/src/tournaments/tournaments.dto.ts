import { IsArray, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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
}

export class UpdateTournamentDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() game?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() place?: string;
  @IsOptional() @IsString() @MaxLength(300) imageUrl?: string;
}

export class ReportDto {
  @IsOptional() @IsString() poolId?: string;
  @IsOptional() @IsString() matchId?: string;
  @IsOptional() @IsString() winnerId?: string;
  @IsOptional() @IsInt() @Min(0) scoreA?: number;
  @IsOptional() @IsInt() @Min(0) scoreB?: number;
}
