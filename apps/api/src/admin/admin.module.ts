import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SettingsController } from './settings.controller';
import { AdminService } from './admin.service';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [CreditsModule],
  controllers: [AdminController, SettingsController],
  providers: [AdminService],
})
export class AdminModule {}
