import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Clé de la ligne « compteur de visiteurs » dans la table Setting (clé/valeur JSON déjà existante : aucune migration). */
export const VISITORS_KEY = 'visitors';

/** Robots, aperçus de lien et outils automatiques : ils ne comptent pas comme des visiteurs. */
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python-requests|headless|lighthouse|pingdom|uptime/i;

@Injectable()
export class VisitsService {
  constructor(private prisma: PrismaService) {}

  /** Nombre total de visiteurs (0 tant que personne n'est passé). */
  async total(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: VISITORS_KEY } });
    const n = Number((row?.value as { count?: number } | null)?.count ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /**
   * Enregistre un nouveau visiteur et renvoie son numéro. Incrément ATOMIQUE en base (une seule requête SQL) : deux visiteurs
   * simultanés reçoivent deux numéros différents, jamais le même. Un robot n'incrémente rien (number = null).
   */
  async register(userAgent: string | undefined): Promise<{ number: number | null; total: number }> {
    if (!userAgent || BOT_RE.test(userAgent)) return { number: null, total: await this.total() };
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      INSERT INTO "Setting" ("key", "value") VALUES (${VISITORS_KEY}, '{"count":1}'::jsonb)
      ON CONFLICT ("key") DO UPDATE
        SET "value" = jsonb_build_object('count', COALESCE(("Setting"."value"->>'count')::int, 0) + 1)
      RETURNING ("Setting"."value"->>'count')::int AS n`;
    const n = Number(rows[0]?.n ?? 0);
    return { number: n || null, total: n };
  }
}
