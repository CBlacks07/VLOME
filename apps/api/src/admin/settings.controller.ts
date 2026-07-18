import { Controller, Get } from '@nestjs/common';
import { AdminService } from './admin.service';

/** Lecture publique des réglages du site (identité, héro, slider, partenaires). */
@Controller('settings')
export class SettingsController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  settings() {
    return this.admin.getSettings();
  }
}
