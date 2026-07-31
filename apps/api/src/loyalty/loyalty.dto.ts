import { IsInt, Max, Min } from 'class-validator';

export class LoyaltySettingsDto {
  @IsInt()
  @Min(1)
  pointValueXof!: number; // valeur d'un point, en FCFA

  @IsInt()
  @Min(0)
  @Max(100)
  maxRedeemPercent!: number; // part maximum du montant réglable en points
}
