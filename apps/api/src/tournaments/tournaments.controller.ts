import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import type { CreateTournamentDto } from './tournaments.service';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly service: TournamentsService) {}

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

  @Post()
  create(@Body() dto: CreateTournamentDto) {
    return this.service.create(dto);
  }

  /* ---------- Pilotage ---------- */

  @Get(':id/state')
  async state(@Param('id') id: string) {
    const s = await this.service.getState(id);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/launch')
  async launch(@Param('id') id: string) {
    const s = await this.service.launch(id);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/finals/start')
  async startFinals(@Param('id') id: string) {
    const s = await this.service.startFinals(id);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }

  @Post(':id/report')
  async report(@Param('id') id: string, @Body() dto: { poolId?: string; matchId?: string; winnerId: string }) {
    const s = await this.service.report(id, dto);
    if (!s) throw new NotFoundException('Tournoi introuvable');
    return s;
  }
}
