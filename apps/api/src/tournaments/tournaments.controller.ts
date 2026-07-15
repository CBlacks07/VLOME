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
}
