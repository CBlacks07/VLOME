import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class EventDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(160) tagline?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  // Dates ISO (AAAA-MM-JJ ou date-heure) ; chaîne vide = effacer.
  @IsOptional() @IsString() @MaxLength(40) startDate?: string;
  @IsOptional() @IsString() @MaxLength(40) endDate?: string;
  @IsOptional() @IsString() @MaxLength(160) place?: string;
  @IsOptional() @IsString() @MaxLength(400) posterUrl?: string;
  @IsOptional() @IsString() @MaxLength(400) bannerUrl?: string;
  @IsOptional() @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'Couleur invalide (format #RRGGBB).' }) accentColor?: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}

export class EventUpdateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(160) tagline?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @MaxLength(40) startDate?: string;
  @IsOptional() @IsString() @MaxLength(40) endDate?: string;
  @IsOptional() @IsString() @MaxLength(160) place?: string;
  @IsOptional() @IsString() @MaxLength(400) posterUrl?: string;
  @IsOptional() @IsString() @MaxLength(400) bannerUrl?: string;
  @IsOptional() @Matches(/^(#[0-9a-fA-F]{6})?$/, { message: 'Couleur invalide (format #RRGGBB).' }) accentColor?: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
}
