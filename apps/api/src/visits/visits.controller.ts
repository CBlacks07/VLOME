import { Body, Controller, Headers, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { VisitsService } from './visits.service';

class PingDto {
  @IsOptional() @IsString() @MaxLength(64) sid?: string;
}

/** Comptage des visiteurs du site — écriture publique et anonyme ; la lecture des chiffres est réservée à l'admin (tableau de bord). */
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  /**
   * Nouveau visiteur : incrémente le compteur (appelé une seule fois par navigateur). Le total n'est PAS renvoyé : il n'est
   * visible que dans le tableau de bord admin. Le numéro sert seulement de repère au navigateur pour ne pas se recompter.
   */
  @Post()
  async register(@Headers('user-agent') userAgent?: string) {
    const r = await this.visits.register(userAgent);
    return { number: r.number };
  }

  /** Signe de vie d'un navigateur ouvert sur le site (alimente « en ligne maintenant » du tableau de bord admin). Rien de chiffré n'est renvoyé. */
  @Post('ping')
  async ping(@Body() dto: PingDto, @Headers('user-agent') userAgent?: string) {
    await this.visits.ping(dto?.sid, userAgent);
    return { ok: true };
  }
}
