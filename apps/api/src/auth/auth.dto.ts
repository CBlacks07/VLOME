import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  // Adresse e-mail OU pseudo (nom affiché) — le champ garde le nom « email » pour rester compatible
  // avec les clients existants.
  @IsString()
  @MinLength(1, { message: 'Email ou pseudo requis.' })
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Mot de passe requis.' })
  password!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Email invalide.' })
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  token!: string;

  @IsString()
  @MinLength(6, { message: 'Mot de passe : au moins 6 caractères.' })
  @MaxLength(72)
  password!: string;
}

export class RegisterDto {
  @IsEmail({}, { message: 'Email invalide.' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Mot de passe : au moins 6 caractères.' })
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;

  // Rôle demandé à l'inscription (ADMIN n'est jamais auto-attribuable).
  @IsOptional()
  @IsIn(['PLAYER', 'ORGANIZER', 'ASSOCIATION'])
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  favoriteGame?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // Club affiché (facultatif) — rattache le compte à la base de joueurs (créé dans le
  // catalogue de clubs si nouveau, fusionné sur un club existant sinon).
  @IsOptional()
  @IsString()
  @MaxLength(80)
  club?: string;

  // Club choisi dans la liste des clubs validés : crée une demande d'adhésion que l'association du club valide.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  clubId?: string;

  // Compte association : nom de l'association (devient son club une fois validée par l'équipe Miabe), site web et présentation.
  @IsOptional()
  @IsString()
  @MaxLength(80)
  associationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  // Motivation présentée par un candidat organisateur — lue par l'admin lors de la validation.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  organizerNote?: string;
}
