import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreditsSettingsDto {
  @IsInt()
  @Min(1)
  priceXof!: number; // prix d'un crédit, en FCFA

  @IsInt()
  @Min(0)
  @Max(50)
  freeTournaments!: number; // nombre de tournois gratuits offerts à la création du compte
}

export class PurchaseCreditsDto {
  @IsInt()
  @Min(1)
  credits!: number;

  @IsString()
  @MaxLength(40)
  paymentMethod!: string;
}
