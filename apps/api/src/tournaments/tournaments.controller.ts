import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import {
  AddPlayerDto, AdjustDto, BattleRoyaleReportDto, ClubDto, CreateTournamentDto, MoveOrderDto, RegisterDto, ReportDto,
  RosterMoveDto, ScoringDto, StartFinalsDto, UpdateTournamentDto,
} from './tournaments.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly service: TournamentsService) {}

  /* ---------- Lecture (public) ---------- */

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post('seed')
  seed() {
    return this.service.seed();
  }

  /* Déclarées avant ':id' pour ne pas être capturées par la route paramétrée. */

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  mine(@CurrentUser() user: JwtUser) {
    return this.service.mine(user);
  }

  @Get('registrations/mine')
  @UseGuards(JwtAuthGuard)
  registrationIds(@CurrentUser() user: JwtUser) {
    return this.service.registrationIds(user);
  }

  @Get('leaderboard')
  leaderboard() {
    return this.service.leaderboard();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const t = await this.service.findOne(id);
    if (!t) throw new NotFoundException('Tournoi introuvable');
    return t;
  }

  @Get(':id/state')
  async state(@Param('id') id: string) {
    const s = await this.service.getState(id);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /* ---------- Écriture (authentification requise) ---------- */

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  create(@Body() dto: CreateTournamentDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateTournamentDto, @CurrentUser() user: JwtUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }

  /* Inscription / désinscription : tout utilisateur connecté. */

  @Post(':id/register')
  @UseGuards(JwtAuthGuard)
  register(@Param('id') id: string, @Body() dto: RegisterDto, @CurrentUser() user: JwtUser) {
    return this.service.register(id, user, dto);
  }

  @Delete(':id/register')
  @UseGuards(JwtAuthGuard)
  unregister(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.unregister(id, user);
  }

  /* Paiement des inscriptions payantes : organisateur/admin uniquement. */

  @Get(':id/registrations')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  listRegistrations(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.listRegistrations(id, user);
  }

  @Post(':id/registrations/:regId/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  confirmPayment(@Param('id') id: string, @Param('regId') regId: string, @CurrentUser() user: JwtUser) {
    return this.service.confirmPayment(id, regId, user);
  }

  @Post(':id/launch')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async launch(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.launch(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/finals/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async startFinals(@Param('id') id: string, @Body() dto: StartFinalsDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.startFinals(id, user, dto.format);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async report(@Param('id') id: string, @Body() dto: ReportDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.report(id, dto, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /** Format Battle Royale : classement complet d'une partie (pas de duel 1v1, donc pas /report). */
  @Post(':id/battle-royale-report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async reportBattleRoyale(@Param('id') id: string, @Body() dto: BattleRoyaleReportDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.reportBattleRoyale(id, dto.gameId, dto.ranking, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /* Gestion des joueurs : organisateur/admin uniquement. */

  @Post(':id/players')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async addPlayer(@Param('id') id: string, @Body() dto: AddPlayerDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.addPlayer(id, dto.name, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Delete(':id/players/:playerId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async removePlayer(@Param('id') id: string, @Param('playerId') playerId: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.removePlayer(id, playerId, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/players/:playerId/disqualify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async disqualifyPlayer(@Param('id') id: string, @Param('playerId') playerId: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.disqualifyPlayer(id, playerId, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Patch(':id/players/:playerId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async renamePlayer(@Param('id') id: string, @Param('playerId') playerId: string, @Body() dto: AddPlayerDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.renamePlayer(id, playerId, dto.name, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Patch(':id/players/:playerId/club')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async setPlayerClub(@Param('id') id: string, @Param('playerId') playerId: string, @Body() dto: ClubDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.setPlayerClub(id, playerId, dto.club, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/players/:playerId/adjust')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async manualAdjust(@Param('id') id: string, @Param('playerId') playerId: string, @Body() dto: AdjustDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.manualAdjust(id, playerId, dto.delta, dto.reason, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /* Historique, barème, répartition des poules : organisateur/admin uniquement. */

  @Post(':id/undo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async undo(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.undo(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async reset(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.reset(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Patch(':id/scoring')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async setScoring(@Param('id') id: string, @Body() dto: ScoringDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.setScoring(id, dto.key, dto.value, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/pools/distribute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async distributePools(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.distributePools(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/pools/:poolId/shuffle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async shufflePoolOrder(@Param('id') id: string, @Param('poolId') poolId: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.shufflePoolOrder(id, poolId, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/pools/:poolId/move')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async movePoolOrder(@Param('id') id: string, @Param('poolId') poolId: string, @Body() dto: MoveOrderDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.movePoolOrder(id, poolId, dto.index, dto.dir, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  // Ordre du roster (formats sans poules : single/double/roundrobin/swiss) — détermine les
  // oppositions du 1er tour, prévisualisées avant lancement (voir TournamentsService.moveRosterOrder).
  @Post(':id/roster/move')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async moveRosterOrder(@Param('id') id: string, @Body() dto: RosterMoveDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.moveRosterOrder(id, dto.playerId, dto.dir, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/roster/shuffle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  async shuffleRosterOrder(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.shuffleRosterOrder(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }
}
