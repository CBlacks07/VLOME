import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckoutDto {
  @IsIn(['fedapay', 'kkiapay']) provider!: 'fedapay' | 'kkiapay';
  @IsIn(['registration', 'order', 'credit']) kind!: 'registration' | 'order' | 'credit';
  @IsString() @MaxLength(60) refId!: string;
}

export class VerifyDto {
  @IsIn(['fedapay', 'kkiapay']) provider!: 'fedapay' | 'kkiapay';
  @IsIn(['registration', 'order', 'credit']) kind!: 'registration' | 'order' | 'credit';
  @IsString() @MaxLength(60) refId!: string;
  // FedaPay : renvoyé dans l'URL de retour ; KkiaPay : renvoyé par le widget. Facultatif pour FedaPay
  // (l'identifiant enregistré à la création de la transaction fait foi).
  @IsOptional() @IsString() @MaxLength(80) transactionId?: string;
}
