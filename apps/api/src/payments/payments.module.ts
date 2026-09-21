import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [TournamentsModule, CreditsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
