import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Email invalide.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Mot de passe requis.' })
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
  @IsIn(['PLAYER', 'ORGANIZER'])
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  favoriteGame?: string;
}
