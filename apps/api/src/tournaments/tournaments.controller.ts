import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { TournamentsService } from './tournaments.service';
import { AddPlayerDto, AdjustDto, BattleRoyaleReportDto, CheckinDto, ClubDto, CorrectResultDto, CreateTournamentDto, MoveOrderDto, PoolPlayerMoveDto, QualifyPerPoolDto, RegisterDto, ReportDto, StationDto, StreamMatchDto, NotifyMatchDto, PredictDto, TeamMembersDto, MatchStartDto, MatchMinutesDto, RosterMoveDto, ScoringDto, StartFinalsDto, UpdateTournamentDto, TiebreakDto, AnnouncementDto, CoAdminDto, MatchTimeDto, PlayerReportDto, ReviewReportDto, PublicationDto, FinalizePoolDto, BroadcastDto } from './tournaments.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OptionalJwtGuard } from '../common/optional-jwt.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly service: TournamentsService) {}

  /* ---------- Lecture (public) ---------- */

  @Get()
  @UseGuards(OptionalJwtGuard)
  findAll(@CurrentUser() user?: JwtUser) {
    return this.service.findAll(user);
  }

  // Réservé à l'admin : n'insère les 7 tournois de démo que si la table est vide (voir
  // TournamentsService.seed), mais reste une écriture en base — jamais accessible sans authentification,
  // et jamais appelé depuis le site (outil de mise en route uniquement).
  @Post('seed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  seed() {
    return this.service.seed();
  }

  /* Déclarées avant ':id' pour ne pas être capturées par la route paramétrée. */

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  mine(@CurrentUser() user: JwtUser) {
    return this.service.mine(user);
  }

  @Get('registrations/mine')
  @UseGuards(JwtAuthGuard)
  registrationIds(@CurrentUser() user: JwtUser) {
    return this.service.registrationIds(user);
  }

  @Get('my-next-matches')
  @UseGuards(JwtAuthGuard)
  myNextMatches(@CurrentUser() user: JwtUser) {
    return this.service.myNextMatches(user.sub);
  }

  @Get('predictors/leaderboard')
  predictorsLeaderboard() {
    return this.service.predictorsLeaderboard();
  }

  @Get('predictors/mine')
  @UseGuards(JwtAuthGuard)
  myPredictorStats(@CurrentUser() user: JwtUser) {
    return this.service.myPredictorStats(user.sub);
  }

  @Get('leaderboard')
  leaderboard() {
    return this.service.leaderboard();
  }

  @Get('players/profile')
  playerProfile(@Query('name') name: string, @Query('uid') uid?: string) {
    if (!name?.trim()) throw new NotFoundException('Joueur introuvable');
    return this.service.playerProfile(name.trim(), uid?.trim() || undefined);
  }

  @Get('players/head-to-head')
  headToHead(@Query('a') a: string, @Query('b') b: string, @Query('auid') auid?: string, @Query('buid') buid?: string) {
    if (!a?.trim() || !b?.trim()) throw new NotFoundException('Joueurs introuvables');
    return this.service.headToHead(a.trim(), b.trim(), auid?.trim() || undefined, buid?.trim() || undefined);
  }

  @Get(':id')
  @UseGuards(OptionalJwtGuard)
  async findOne(@Param('id') id: string, @CurrentUser() user?: JwtUser) {
    await this.service.assertVisible(id, user);
    const t = await this.service.findOne(id);
    if (!t) throw new NotFoundException('Tournoi introuvable');
    return t;
  }

  @Get(':id/predictions')
  predictionBoard(@Param('id') id: string) {
    return this.service.predictionBoard(id);
  }

  @Get(':id/predictions/mine')
  @UseGuards(JwtAuthGuard)
  myPredictions(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.myPredictions(id, user.sub);
  }

  @Post(':id/predictions')
  @UseGuards(JwtAuthGuard)
  predict(@Param('id') id: string, @Body() dto: PredictDto, @CurrentUser() user: JwtUser) {
    return this.service.predict(id, user, dto.matchKey, dto.pick);
  }

  @Get(':id/state')
  @UseGuards(OptionalJwtGuard)
  async state(@Param('id') id: string, @CurrentUser() user?: JwtUser) {
    await this.service.assertVisible(id, user);
    const s = await this.service.getState(id);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /* ---------- Écriture (authentification requise) ---------- */

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  create(@Body() dto: CreateTournamentDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  update(@Param('id') id: string, @Body() dto: UpdateTournamentDto, @CurrentUser() user: JwtUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
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
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  listRegistrations(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.listRegistrations(id, user);
  }

  @Get(':id/registrations/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async exportRegistrations(@Param('id') id: string, @CurrentUser() user: JwtUser, @Res() res: Response) {
    const { filename, buffer } = await this.service.exportRegistrationsXlsx(id, user);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  @Get(':id/results/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async exportResults(@Param('id') id: string, @CurrentUser() user: JwtUser, @Res() res: Response) {
    const { filename, buffer } = await this.service.exportResultsXlsx(id, user);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }

  @Post(':id/checkin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  checkIn(@Param('id') id: string, @Body() dto: CheckinDto, @CurrentUser() user: JwtUser) {
    return this.service.checkIn(id, dto, user);
  }

  @Post(':id/station')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  setStation(@Param('id') id: string, @Body() dto: StationDto, @CurrentUser() user: JwtUser) {
    return this.service.setStation(id, dto.key, dto.label, user);
  }

  @Post(':id/duplicate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  duplicate(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.duplicate(id, user);
  }

  @Post(':id/match-start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  setMatchStart(@Param('id') id: string, @Body() dto: MatchStartDto, @CurrentUser() user: JwtUser) {
    return this.service.setMatchStart(id, dto.key, dto.on, user);
  }

  @Post(':id/match-minutes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  setMatchMinutes(@Param('id') id: string, @Body() dto: MatchMinutesDto, @CurrentUser() user: JwtUser) {
    return this.service.setMatchMinutes(id, dto.minutes, user);
  }

  /** Annule l'appel d'un match (joueurs appelés par erreur). */
  @Post(':id/match-uncall')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  uncallMatch(@Param('id') id: string, @Body() dto: NotifyMatchDto, @CurrentUser() user: JwtUser) {
    return this.service.uncallMatch(id, dto.key, user);
  }

  @Post(':id/broadcast')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  broadcast(@Param('id') id: string, @Body() dto: BroadcastDto, @CurrentUser() user: JwtUser) {
    return this.service.broadcast(id, dto.keys, dto.text, user);
  }

  @Post(':id/notify-match')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  notifyMatch(@Param('id') id: string, @Body() dto: NotifyMatchDto, @CurrentUser() user: JwtUser) {
    return this.service.notifyMatch(id, dto.key, user);
  }

  @Post(':id/stream-match')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  setStreamMatch(@Param('id') id: string, @Body() dto: StreamMatchDto, @CurrentUser() user: JwtUser) {
    return this.service.setStreamMatch(id, dto.key, dto.on, user);
  }

  @Post(':id/registrations/:regId/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  confirmPayment(@Param('id') id: string, @Param('regId') regId: string, @CurrentUser() user: JwtUser) {
    return this.service.confirmPayment(id, regId, user);
  }

  @Post(':id/launch')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async launch(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.launch(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/finals/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async startFinals(@Param('id') id: string, @Body() dto: StartFinalsDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.startFinals(id, user, dto.format);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async report(@Param('id') id: string, @Body() dto: ReportDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.report(id, dto, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /** Corrige un match déjà joué (crayon) — voir TournamentsService.correctResult. */
  @Post(':id/player-report')
  @UseGuards(JwtAuthGuard)
  playerReport(@Param('id') id: string, @Body() dto: PlayerReportDto, @CurrentUser() user: JwtUser) {
    return this.service.playerReport(id, user, dto);
  }

  /** Brouillon → inscriptions ouvertes → closes (tournoi hors événement, avant le lancement). */
  @Post(':id/publication')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  publication(@Param('id') id: string, @Body() dto: PublicationDto, @CurrentUser() user: JwtUser) {
    return this.service.setPublication(id, user, dto.status);
  }

  @Get(':id/score-reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  scoreReports(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.scoreReports(id, user);
  }

  @Post(':id/score-reports/:reportId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  reviewReport(@Param('id') id: string, @Param('reportId') reportId: string, @Body() dto: ReviewReportDto, @CurrentUser() user: JwtUser) {
    return this.service.reviewReport(id, reportId, dto.decision, user);
  }

  @Get(':id/organisation')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  organisation(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.organisation(id, user);
  }

  @Post(':id/co-admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  addCoAdmin(@Param('id') id: string, @Body() dto: CoAdminDto, @CurrentUser() user: JwtUser) {
    return this.service.addCoAdmin(id, dto.email, user);
  }

  @Delete(':id/co-admins/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  removeCoAdmin(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: JwtUser) {
    return this.service.removeCoAdmin(id, userId, user);
  }

  @Post(':id/announcements')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  announce(@Param('id') id: string, @Body() dto: AnnouncementDto, @CurrentUser() user: JwtUser) {
    return this.service.announce(id, dto.text, user);
  }

  @Delete(':id/announcements/:announcementId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  removeAnnouncement(@Param('id') id: string, @Param('announcementId') announcementId: string, @CurrentUser() user: JwtUser) {
    return this.service.removeAnnouncement(id, announcementId, user);
  }

  @Post(':id/match-time')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  matchTime(@Param('id') id: string, @Body() dto: MatchTimeDto, @CurrentUser() user: JwtUser) {
    return this.service.setMatchTime(id, dto.key, dto.at, user);
  }

  @Post(':id/tiebreak')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  tiebreak(@Param('id') id: string, @Body() dto: TiebreakDto, @CurrentUser() user: JwtUser) {
    return this.service.tiebreak(id, dto.playerId, dto.delta, user);
  }

  @Post(':id/correct')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async correctResult(@Param('id') id: string, @Body() dto: CorrectResultDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.correctResult(id, dto, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /** Format Battle Royale : classement complet d'une partie (pas de duel 1v1, donc pas /report). */
  @Post(':id/battle-royale-report')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async reportBattleRoyale(@Param('id') id: string, @Body() dto: BattleRoyaleReportDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.reportBattleRoyale(id, dto.gameId, dto.ranking, user, dto.kills, dto.times);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /* Gestion des joueurs : organisateur/admin uniquement. */

  @Post(':id/players')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async addPlayer(@Param('id') id: string, @Body() dto: AddPlayerDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.addPlayer(id, dto.name, user, dto.members);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Delete(':id/players/:playerId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async removePlayer(@Param('id') id: string, @Param('playerId') playerId: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.removePlayer(id, playerId, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/players/:playerId/members')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async setTeamMembers(@Param('id') id: string, @Param('playerId') playerId: string, @Body() dto: TeamMembersDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.setTeamMembers(id, playerId, dto.members, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/players/:playerId/disqualify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async disqualifyPlayer(@Param('id') id: string, @Param('playerId') playerId: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.disqualifyPlayer(id, playerId, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Patch(':id/players/:playerId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async renamePlayer(@Param('id') id: string, @Param('playerId') playerId: string, @Body() dto: AddPlayerDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.renamePlayer(id, playerId, dto.name, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Patch(':id/players/:playerId/club')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async setPlayerClub(@Param('id') id: string, @Param('playerId') playerId: string, @Body() dto: ClubDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.setPlayerClub(id, playerId, dto.club, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/players/:playerId/adjust')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async manualAdjust(@Param('id') id: string, @Param('playerId') playerId: string, @Body() dto: AdjustDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.manualAdjust(id, playerId, dto.delta, dto.reason, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  /* Historique, barème, répartition des poules : organisateur/admin uniquement. */

  @Post(':id/undo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async undo(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.undo(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async reset(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.reset(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Patch(':id/scoring')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async setScoring(@Param('id') id: string, @Body() dto: ScoringDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.setScoring(id, dto.key, dto.value, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/scoring/autofit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async autoFitScoring(@Param('id') id: string, @CurrentUser() user: JwtUser, @Body() body?: { simulatedPlayers?: number }) {
    const simulatedPlayers = typeof body?.simulatedPlayers === 'number' && Number.isFinite(body.simulatedPlayers) ? body.simulatedPlayers : undefined;
    const s = await this.service.autoFitScoring(id, user, simulatedPlayers);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/pools/distribute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async distributePools(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.distributePools(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/pools/:poolId/finalize')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  finalizePool(@Param('id') id: string, @Param('poolId') poolId: string, @Body() dto: FinalizePoolDto, @CurrentUser() user: JwtUser) {
    return this.service.finalizePool(id, poolId, dto.order, user);
  }

  @Post(':id/pools/:poolId/shuffle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async shufflePoolOrder(@Param('id') id: string, @Param('poolId') poolId: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.shufflePoolOrder(id, poolId, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/pools/:poolId/move')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async movePoolOrder(@Param('id') id: string, @Param('poolId') poolId: string, @Body() dto: MoveOrderDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.movePoolOrder(id, poolId, dto.index, dto.dir, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  // Rééquilibrage manuel de l'effectif des poules (avant lancement) — distinct de /move ci-dessus,
  // qui ne fait que réordonner à l'intérieur d'une même poule.
  @Post(':id/pools/:poolId/players/move')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async movePoolPlayer(@Param('id') id: string, @Param('poolId') poolId: string, @Body() dto: PoolPlayerMoveDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.movePoolPlayer(id, poolId, dto.playerId, dto.dir, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Patch(':id/pools/qualify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async setQualifyPerPool(@Param('id') id: string, @Body() dto: QualifyPerPoolDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.setQualifyPerPool(id, dto.value, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  // Ordre du roster (formats sans poules : single/double/roundrobin/swiss) — détermine les
  // oppositions du 1er tour, prévisualisées avant lancement (voir TournamentsService.moveRosterOrder).
  @Post(':id/roster/move')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async moveRosterOrder(@Param('id') id: string, @Body() dto: RosterMoveDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.moveRosterOrder(id, dto.playerId, dto.dir, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/roster/shuffle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  async shuffleRosterOrder(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.shuffleRosterOrder(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }
}
