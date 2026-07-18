import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SettingsController } from './settings.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController, SettingsController],
  providers: [AdminService],
})
export class AdminModule {}
