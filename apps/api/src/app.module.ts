import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { AuthModule } from './auth/auth.module';
import { ShopModule } from './shop/shop.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [PrismaModule, AuthModule, TournamentsModule, ShopModule, AdminModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
