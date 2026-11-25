import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RosterService } from './roster.service';
import { ClubDto, GameDto, RosterPlayerDto } from './roster.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller()
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  /* Lecture : organisateur/admin (utile pour piocher des joueurs à la création d'un tournoi). */

  @Get('roster')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  listPlayers() {
    return this.roster.listPlayers();
  }

  /** Fiche complète d'un joueur de la base — stats, commandes, inscriptions (si un compte est relié). */
  @Get('roster/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  playerDetail(@Param('id') id: string) {
    return this.roster.playerDetail(id);
  }

  // Lecture publique (comme le catalogue de jeux) : sert aussi de suggestions à l'inscription
  // et dans le profil joueur, pas seulement à la création d'un tournoi.
  @Get('clubs')
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

  /* Catalogue des jeux — lecture publique (sert aussi aux filtres de classements),
   * écriture réservée à l'admin. */

  @Get('games')
  listGames() {
    return this.roster.listGames();
  }

  @Post('games')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createGame(@Body() dto: GameDto) {
    return this.roster.createGame(dto);
  }

  @Patch('games/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updateGame(@Param('id') id: string, @Body() dto: GameDto) {
    return this.roster.updateGame(id, dto);
  }

  @Delete('games/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  removeGame(@Param('id') id: string) {
    return this.roster.removeGame(id);
  }
}
