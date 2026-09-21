import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CheckoutDto, VerifyDto } from './payments.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Passerelles activées (clés présentes) — public : sert à n'afficher que les moyens réellement utilisables. */
  @Get('config')
  config() {
    return this.payments.publicConfig();
  }

  /** Démarre un paiement en ligne pour une inscription / commande / achat de crédits déjà créé(e) en attente. */
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() user: JwtUser, @Body() dto: CheckoutDto) {
    return this.payments.checkout(user, dto);
  }

  /** Vérifie la transaction auprès du prestataire et, si elle est approuvée, valide l'élément payé. */
  @Post('verify')
  @UseGuards(JwtAuthGuard)
  verify(@CurrentUser() user: JwtUser, @Body() dto: VerifyDto) {
    return this.payments.verify(user, dto);
  }

  /** Notification serveur FedaPay. Le contenu reçu n'est jamais cru : on relit la transaction chez FedaPay. */
  @Post('fedapay/webhook')
  @HttpCode(200)
  fedapayWebhook(@Body() body: any) {
    return this.payments.fedapayWebhook(body);
  }
}
