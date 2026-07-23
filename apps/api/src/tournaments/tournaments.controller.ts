import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto, RegisterDto, ReportDto, UpdateTournamentDto } from './tournaments.dto';
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
    return this.service.create(dto, user.sub);
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
  async startFinals(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.startFinals(id, user);
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
}
