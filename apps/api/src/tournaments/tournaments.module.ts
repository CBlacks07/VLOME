import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [LoyaltyModule, CreditsModule],
  controllers: [TournamentsController],
  providers: [TournamentsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
