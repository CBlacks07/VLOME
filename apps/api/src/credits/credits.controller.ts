import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { PurchaseCreditsDto } from './credits.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  /** Tarif en vigueur — public, affiché avant même de se connecter (page organisateur). */
  @Get('settings')
  settings() {
    return this.credits.getSettings();
  }

  /** Solde, quota gratuit et historique de l'organisateur connecté. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtUser) {
    return this.credits.meSummary(user.sub);
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  purchase(@CurrentUser() user: JwtUser, @Body() dto: PurchaseCreditsDto) {
    return this.credits.requestPurchase(user.sub, dto.credits, dto.paymentMethod);
  }

  /** Annule une demande d'achat pas encore confirmée (changement d'avis, erreur de saisie). */
  @Delete('purchase/:id')
  @UseGuards(JwtAuthGuard)
  cancelPurchase(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.credits.cancelPurchase(id, user.sub, user.role === 'ADMIN');
  }
}
