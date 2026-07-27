import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RosterService } from './roster.service';
import { ClubDto, RosterPlayerDto } from './roster.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller()
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  /* Lecture : organisateur/admin (utile pour piocher des joueurs à la création d'un tournoi). */

  @Get('roster')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  listPlayers() {
    return this.roster.listPlayers();
  }

  @Get('clubs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  listClubs() {
    return this.roster.listClubs();
  }

  /* Écriture : admin uniquement (gestion depuis l'administration). */

  @Post('roster')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  addPlayer(@Body() dto: RosterPlayerDto) {
    return this.roster.addPlayer(dto);
  }

  @Patch('roster/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updatePlayer(@Param('id') id: string, @Body() dto: RosterPlayerDto) {
    return this.roster.updatePlayer(id, dto);
  }

  @Delete('roster/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  removePlayer(@Param('id') id: string) {
    return this.roster.removePlayer(id);
  }

  @Post('clubs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createClub(@Body() dto: ClubDto) {
    return this.roster.createClub(dto);
  }

  @Patch('clubs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updateClub(@Param('id') id: string, @Body() dto: ClubDto) {
    return this.roster.updateClub(id, dto);
  }

  @Delete('clubs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  removeClub(@Param('id') id: string) {
    return this.roster.removeClub(id);
  }
}
