import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SettingsController } from './settings.controller';
import { AdminService } from './admin.service';
import { CreditsModule } from '../credits/credits.module';
import { DashboardService } from './dashboard.service';
import { VisitsModule } from '../visits/visits.module';
import { AssociationsModule } from '../associations/associations.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [CreditsModule, VisitsModule, AssociationsModule, PaymentsModule],
  controllers: [AdminController, SettingsController],
  providers: [AdminService, DashboardService],
})
export class AdminModule {}
