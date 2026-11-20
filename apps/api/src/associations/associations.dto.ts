import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Profil public d'une association (son club). Chaîne vide = effacer le champ. */
export class UpdateAssociationDto {
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @MaxLength(300) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string;
  @IsOptional() @IsEmail({}, { message: 'Adresse de contact invalide.' }) contactEmail?: string;
}

export class ReviewDecisionDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
}
