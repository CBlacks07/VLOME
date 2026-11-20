import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckoutDto {
  @IsIn(['fedapay']) provider!: 'fedapay';
  @IsIn(['registration', 'order', 'credit']) kind!: 'registration' | 'order' | 'credit';
  @IsString() @MaxLength(60) refId!: string;
  // Origine du site d'où l'utilisateur paie (ex. https://www.exemple.com). FedaPay le ramène exactement là :
  // sur une autre origine, le navigateur n'aurait pas sa session (localStorage propre à chaque origine).
  @IsOptional() @IsString() @MaxLength(120) returnOrigin?: string;
}

export class VerifyDto {
  @IsIn(['fedapay']) provider!: 'fedapay';
  @IsIn(['registration', 'order', 'credit']) kind!: 'registration' | 'order' | 'credit';
  @IsString() @MaxLength(60) refId!: string;
  // FedaPay : renvoyé dans l'URL de retour. Facultatif
  // (l'identifiant enregistré à la création de la transaction fait foi).
  @IsOptional() @IsString() @MaxLength(80) transactionId?: string;
}
