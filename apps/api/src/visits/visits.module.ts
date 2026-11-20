import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService], // lu aussi par le tableau de bord admin
})
export class VisitsModule {}
