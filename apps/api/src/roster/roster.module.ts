import { Module } from '@nestjs/common';
import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';
import { UsersModule } from '../users/users.module';
import { TournamentsModule } from '../tournaments/tournaments.module';

@Module({
  imports: [UsersModule, TournamentsModule],
  controllers: [RosterController],
  providers: [RosterService],
})
export class RosterModule {}
