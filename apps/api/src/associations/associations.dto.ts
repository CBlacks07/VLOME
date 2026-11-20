import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Profil public d'une association (son club). Chaîne vide = effacer le champ. */
export class UpdateAssociationDto {
  @IsOptional() @IsString() @MaxLength(60) city?: string;
  @IsOptional() @IsString() @MaxLength(300) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
  @IsOptional() @IsString() @MaxLength(600) description?: string;
  @IsOptional() @IsEmail({}, { message: 'Adresse de contact invalide.' }) contactEmail?: string;
}

/** Rattache un compte association (créé si besoin) à un club existant sans propriétaire — action admin. */
export class AttachOwnerDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide.' }) email!: string;
}

export class ReviewDecisionDto {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
}
