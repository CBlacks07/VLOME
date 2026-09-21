import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { AuthModule } from './auth/auth.module';
import { ShopModule } from './shop/shop.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';
import { NewsModule } from './news/news.module';
import { UploadsModule } from './uploads/uploads.module';
import { GalleryModule } from './gallery/gallery.module';
import { RosterModule } from './roster/roster.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { CreditsModule } from './credits/credits.module';
import { PaymentsModule } from './payments/payments.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [PrismaModule, MailModule, AuthModule, TournamentsModule, ShopModule, AdminModule, UsersModule, NewsModule, UploadsModule, GalleryModule, RosterModule, LoyaltyModule, CreditsModule, PaymentsModule, EventsModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
