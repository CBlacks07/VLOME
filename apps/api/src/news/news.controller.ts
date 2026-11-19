import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { NewsService } from './news.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list() {
    return this.news.listPublished();
  }

  // Réservé à l'admin : n'insère les actus de démo que si la table est vide (voir NewsService.seed),
  // mais reste une écriture en base, et publiée (published: true) — jamais accessible sans
  // authentification (voir le même garde sur /tournaments/seed).
  @Post('seed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  seed() {
    return this.news.seed();
  }
}
