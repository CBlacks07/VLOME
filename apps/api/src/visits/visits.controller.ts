import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { VisitsService } from './visits.service';

class PingDto {
  @IsOptional() @IsString() @MaxLength(64) sid?: string;
}

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

  /** Signe de vie d'un navigateur ouvert sur le site (alimente « en ligne maintenant » du tableau de bord admin). */
  @Post('ping')
  ping(@Body() dto: PingDto, @Headers('user-agent') userAgent?: string) {
    return this.visits.ping(dto?.sid, userAgent);
  }
}
