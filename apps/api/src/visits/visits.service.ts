import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Clés des lignes « compteur » dans la table Setting (clé/valeur JSON déjà existante : aucune migration). */
export const VISITORS_KEY = 'visitors'; // { count, days: { 'YYYY-MM-DD': n } }
export const PRESENCE_KEY = 'presence'; // { <identifiant de session>: <dernier signe de vie, secondes> }

/** Un visiteur est « en ligne » s'il a donné signe de vie dans cette fenêtre (le site envoie un signal toutes les ~45 s). */
export const PRESENCE_WINDOW_S = 150;

/** Robots, aperçus de lien et outils automatiques : ils ne comptent pas comme des visiteurs. */
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python-requests|headless|lighthouse|pingdom|uptime/i;

/** Identifiant de session anonyme tiré au hasard par le navigateur (jamais une donnée personnelle). */
const SID_RE = /^[A-Za-z0-9_-]{8,48}$/;

@Injectable()
export class VisitsService {
  constructor(private prisma: PrismaService) {}

  private async read<T>(key: string): Promise<T | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as T | null) ?? null;
  }

  /** Nombre total de visiteurs (0 tant que personne n'est passé). */
  async total(): Promise<number> {
    const v = await this.read<{ count?: number }>(VISITORS_KEY);
    const n = Number(v?.count ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /** Visiteurs par jour (UTC = heure du Togo), pour le tableau de bord. */
  async days(): Promise<Record<string, number>> {
    const v = await this.read<{ days?: Record<string, number> }>(VISITORS_KEY);
    return v?.days && typeof v.days === 'object' ? v.days : {};
  }

  /** Visiteurs actuellement sur le site (signe de vie récent). */
  async online(): Promise<number> {
    const v = await this.read<Record<string, number>>(PRESENCE_KEY);
    if (!v || typeof v !== 'object') return 0;
    const cutoff = Math.floor(Date.now() / 1000) - PRESENCE_WINDOW_S;
    return Object.values(v).filter((t) => Number(t) > cutoff).length;
  }

  /**
   * Enregistre un nouveau visiteur et renvoie son numéro. Incrément ATOMIQUE en base (une seule requête SQL) : deux visiteurs
   * simultanés reçoivent deux numéros différents, jamais le même. Le compte du jour est tenu dans la même ligne. Un robot
   * n'incrémente rien (number = null).
   */
  async register(userAgent: string | undefined): Promise<{ number: number | null; total: number }> {
    if (!userAgent || BOT_RE.test(userAgent)) return { number: null, total: await this.total() };
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      INSERT INTO "Setting" ("key", "value")
      VALUES (${VISITORS_KEY}, jsonb_build_object('count', 1, 'days', jsonb_build_object(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 1)))
      ON CONFLICT ("key") DO UPDATE SET "value" = jsonb_build_object(
        'count', COALESCE(("Setting"."value"->>'count')::int, 0) + 1,
        'days', COALESCE("Setting"."value"->'days', '{}'::jsonb) || jsonb_build_object(
          to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
          COALESCE(("Setting"."value"->'days'->>to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'))::int, 0) + 1))
      RETURNING ("Setting"."value"->>'count')::int AS n`;
    const n = Number(rows[0]?.n ?? 0);
    return { number: n || null, total: n };
  }

  /**
   * Signe de vie d'un navigateur (toutes les ~45 s tant que l'onglet est visible) : met à jour sa dernière présence et
   * supprime au passage ceux qui n'ont plus donné signe de vie — une seule requête SQL, la ligne reste donc minuscule.
   * Aucune donnée personnelle : seulement un identifiant de session aléatoire et une heure.
   */
  async ping(sid: string | undefined, userAgent: string | undefined): Promise<{ online: number }> {
    if (!sid || !SID_RE.test(sid) || !userAgent || BOT_RE.test(userAgent)) return { online: await this.online() };
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - PRESENCE_WINDOW_S;
    const rows = await this.prisma.$queryRaw<{ online: number }[]>`
      INSERT INTO "Setting" ("key", "value") VALUES (${PRESENCE_KEY}, jsonb_build_object(${sid}::text, ${now}::bigint))
      ON CONFLICT ("key") DO UPDATE SET "value" = (
        SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        FROM jsonb_each(COALESCE("Setting"."value", '{}'::jsonb) || jsonb_build_object(${sid}::text, ${now}::bigint)) AS e
        WHERE (e.value)::text::bigint > ${cutoff}::bigint)
      RETURNING (SELECT count(*)::int FROM jsonb_object_keys("Setting"."value")) AS online`;
    return { online: Number(rows[0]?.online ?? 0) };
  }
}
