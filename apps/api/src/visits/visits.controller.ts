import { Controller, Get, Headers, Post } from '@nestjs/common';
import { VisitsService } from './visits.service';

/** Compteur de visiteurs du site — public, sans connexion, aucune donnée personnelle (juste un numéro). */
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  /** Nombre total de visiteurs. */
  @Get()
  async total() {
    return { total: await this.visits.total() };
  }

  /** Nouveau visiteur : incrémente le compteur et renvoie son numéro (appelé une seule fois par navigateur). */
  @Post()
  register(@Headers('user-agent') userAgent?: string) {
    return this.visits.register(userAgent);
  }
}
