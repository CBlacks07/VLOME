import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { TournamentsModule } from './tournaments/tournaments.module';

@Module({
  imports: [PrismaModule, TournamentsModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
