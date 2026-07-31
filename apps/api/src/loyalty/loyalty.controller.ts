import { Controller, Get, UseGuards } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  /** Taux de conversion en vigueur — public, nécessaire pour afficher les badges promo en boutique. */
  @Get('settings')
  settings() {
    return this.loyalty.getSettings();
  }

  /** Solde + historique du membre connecté. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtUser) {
    const [balance, history] = await Promise.all([this.loyalty.balance(user.sub), this.loyalty.history(user.sub)]);
    return { balance, history };
  }
}
