import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto, ReportDto, UpdateTournamentDto } from './tournaments.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

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
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateTournamentDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user.sub);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() dto: UpdateTournamentDto, @CurrentUser() user: JwtUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.remove(id, user);
  }

  @Post(':id/launch')
  @UseGuards(JwtAuthGuard)
  async launch(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.launch(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/finals/start')
  @UseGuards(JwtAuthGuard)
  async startFinals(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const s = await this.service.startFinals(id, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  async report(@Param('id') id: string, @Body() dto: ReportDto, @CurrentUser() user: JwtUser) {
    const s = await this.service.report(id, dto, user);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }
}
