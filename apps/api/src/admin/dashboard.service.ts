import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VisitsService } from '../visits/visits.service';
import { SESSION_SECRET_CONFIGURED } from '../auth/auth.module';

export const DAY_MS = 86_400_000;
/** Nombre de jours des courbes du tableau de bord. */
export const SERIES_DAYS = 14;

/** Les N derniers jours (UTC = heure du Togo), du plus ancien au plus récent, au format YYYY-MM-DD. */
export function dayKeys(now: Date, n = SERIES_DAYS): string[] {
  const today0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(today0 - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Aligne des lignes « jour → valeur » sur la liste de jours (0 pour un jour sans événement). */
export function fillSeries(keys: string[], rows: { d: string; n?: number; amt?: number }[], field: 'n' | 'amt'): number[] {
  const byDay = new Map(rows.map((r) => [r.d, Number(r[field] ?? 0)]));
  return keys.map((k) => byDay.get(k) ?? 0);
}

export type ActivityTone = 'info' | 'good' | 'warn';
export interface ActivityItem {
  type: 'user' | 'registration' | 'order' | 'credits' | 'tournament' | 'result';
  ts: number; title: string; detail?: string; tone: ActivityTone;
}

/** Fusionne plusieurs sources d'événements : plus récent d'abord, limité à `limit`. */
export function mergeActivity(sources: ActivityItem[][], limit = 30): ActivityItem[] {
  return sources.flat().filter((a) => Number.isFinite(a.ts)).sort((a, b) => b.ts - a.ts).slice(0, limit);
}

interface EngineLogEntry { stage?: string; a?: string | null; b?: string | null; winner?: string; ts?: number }
interface EngineLite { players?: { id: string; name: string }[]; log?: EngineLogEntry[]; finals?: unknown }

const CHEAP_STAGES = new Set(['championBonus', 'adjust', 'streakBonus']);

/** Résumé d'un tournoi en direct, lu dans son état moteur (JSON) sans rejouer le moteur. */
export function liveSummary(row: { id: string; name: string; game: string | null; format: string; engineState: unknown }) {
  const st = (row.engineState ?? {}) as EngineLite;
  const log = (st.log ?? []).filter((l) => l.a && l.b && l.winner && !CHEAP_STAGES.has(l.stage ?? ''));
  const lastTs = log.reduce((m, l) => Math.max(m, Number(l.ts) || 0), 0);
  return {
    id: row.id, name: row.name, game: row.game ?? '', format: row.format,
    players: st.players?.length ?? 0, played: log.length, lastTs: lastTs || null,
    phase: st.finals ? 'finals' : 'pools',
  };
}

/** Derniers résultats de match d'un tournoi en direct, sous forme d'événements de l'activité. */
export function recentResults(row: { name: string; engineState: unknown }, sinceMs: number, limit = 12): ActivityItem[] {
  const st = (row.engineState ?? {}) as EngineLite;
  const names = new Map((st.players ?? []).map((p) => [p.id, p.name]));
  return (st.log ?? [])
    .filter((l) => l.a && l.b && l.winner && !CHEAP_STAGES.has(l.stage ?? '') && Number(l.ts) >= sinceMs)
    .slice(-limit)
    .map((l) => {
      const loser = l.winner === l.a ? l.b! : l.a!;
      return { type: 'result' as const, ts: Number(l.ts), tone: 'good' as const, title: `${names.get(l.winner!) ?? 'Un joueur'} bat ${names.get(loser) ?? 'un joueur'}`, detail: row.name };
    });
}

type DayRow = { d: string; n: number; amt: number };

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private visits: VisitsService) {}

  /** Tableau de bord de pilotage (admin) : chiffres clés, courbes sur 14 jours, à-traiter, tournois en direct, activité récente. */
  async get() {
    const now = new Date();
    const keys = dayKeys(now);
    const from = new Date(`${keys[0]}T00:00:00.000Z`);
    const since48h = now.getTime() - 2 * DAY_MS;

    const [
      usersTotal, tournamentsTotal, registrationsTotal, ordersTotal, productsTotal,
      usersByDay, regsByDay, ordersByDay, creditsByDay,
      tournamentsByStatus, eventsByStatus,
      pendingRegistrations, pendingOrders, organizersPending, lowStock, outOfStock,
      regPaid, orderPaid, creditPaid,
      liveRows, recentUsers, recentRegs, recentOrders, recentCredits, recentTournaments,
      visitsTotal, visitsDays, online,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.tournament.count(),
      this.prisma.registration.count(),
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.$queryRaw<DayRow[]>`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n, 0::int AS amt FROM "User" WHERE "createdAt" >= ${from} GROUP BY 1`,
      this.prisma.$queryRaw<DayRow[]>`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n, COALESCE(sum("amountXof") FILTER (WHERE "paymentStatus" = 'paid'), 0)::int AS amt FROM "Registration" WHERE "createdAt" >= ${from} GROUP BY 1`,
      this.prisma.$queryRaw<DayRow[]>`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n, COALESCE(sum("totalXof") FILTER (WHERE "status" IN ('paid', 'delivered')), 0)::int AS amt FROM "Order" WHERE "createdAt" >= ${from} GROUP BY 1`,
      this.prisma.$queryRaw<DayRow[]>`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n, COALESCE(sum("amountXof") FILTER (WHERE "status" = 'paid'), 0)::int AS amt FROM "CreditPurchase" WHERE "createdAt" >= ${from} GROUP BY 1`,
      this.prisma.tournament.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.event.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.registration.count({ where: { paymentStatus: 'pending' } }),
      this.prisma.order.count({ where: { status: 'pending' } }),
      this.prisma.user.count({ where: { role: 'ORGANIZER', organizerStatus: 'PENDING' } }),
      this.prisma.product.count({ where: { stock: { gt: 0, lte: 3 } } }),
      this.prisma.product.count({ where: { stock: { lte: 0 } } }),
      this.prisma.registration.aggregate({ _sum: { amountXof: true }, where: { paymentStatus: 'paid' } }),
      this.prisma.order.aggregate({ _sum: { totalXof: true }, where: { status: { in: ['paid', 'delivered'] } } }),
      this.prisma.creditPurchase.aggregate({ _sum: { amountXof: true }, where: { status: 'paid' } }),
      this.prisma.tournament.findMany({ where: { status: 'LIVE' }, take: 12, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, game: true, format: true, engineState: true } }),
      this.prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { displayName: true, role: true, organizerStatus: true, createdAt: true } }),
      this.prisma.registration.findMany({ orderBy: { createdAt: 'desc' }, take: 12, select: { playerName: true, amountXof: true, paymentStatus: true, createdAt: true, tournament: { select: { name: true } } } }),
      this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { reference: true, totalXof: true, status: true, createdAt: true, user: { select: { displayName: true } } } }),
      this.prisma.creditPurchase.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { credits: true, amountXof: true, status: true, createdAt: true, user: { select: { displayName: true } } } }),
      this.prisma.tournament.findMany({ orderBy: { createdAt: 'desc' }, take: 6, select: { name: true, game: true, createdAt: true } }),
      this.visits.total(),
      this.visits.days(),
      this.visits.online(),
    ]);

    const statusCount = (rows: { status: string; _count: { _all: number } }[], s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
    const money = (n: number) => `${n.toLocaleString('fr-FR')} F`;

    const visitorsSeries = keys.map((k) => Number(visitsDays[k] ?? 0));
    const signups = fillSeries(keys, usersByDay, 'n');
    const registrations = fillSeries(keys, regsByDay, 'n');
    const orders = fillSeries(keys, ordersByDay, 'n');
    const regAmt = fillSeries(keys, regsByDay, 'amt');
    const orderAmt = fillSeries(keys, ordersByDay, 'amt');
    const creditAmt = fillSeries(keys, creditsByDay, 'amt');
    const revenue = keys.map((_, i) => regAmt[i] + orderAmt[i] + creditAmt[i]); // inscriptions payées + commandes payées/livrées + crédits payés

    const activity = mergeActivity([
      recentUsers.map((u) => ({
        type: 'user' as const, ts: u.createdAt.getTime(), tone: u.organizerStatus === 'PENDING' ? 'warn' as const : 'info' as const,
        title: u.organizerStatus === 'PENDING' ? `${u.displayName} demande à devenir organisateur` : `Nouveau compte : ${u.displayName}`,
        detail: u.role === 'ORGANIZER' ? 'Organisateur' : u.role === 'ADMIN' ? 'Admin' : 'Joueur',
      })),
      recentRegs.map((r) => ({
        type: 'registration' as const, ts: r.createdAt.getTime(), tone: r.paymentStatus === 'pending' ? 'warn' as const : 'good' as const,
        title: `${r.playerName} s'inscrit${r.paymentStatus === 'pending' ? ' (paiement en attente)' : ''}`,
        detail: `${r.tournament?.name ?? 'Tournoi'}${r.amountXof ? ` · ${money(r.amountXof)}` : ''}`,
      })),
      recentOrders.map((o) => ({
        type: 'order' as const, ts: o.createdAt.getTime(), tone: o.status === 'pending' ? 'warn' as const : o.status === 'cancelled' ? 'info' as const : 'good' as const,
        title: `Commande ${o.reference}${o.user?.displayName ? ` · ${o.user.displayName}` : ''}`,
        detail: `${money(o.totalXof)} · ${o.status === 'pending' ? 'à traiter' : o.status === 'paid' ? 'payée' : o.status === 'delivered' ? 'livrée' : 'annulée'}`,
      })),
      recentCredits.map((c) => ({
        type: 'credits' as const, ts: c.createdAt.getTime(), tone: c.status === 'paid' ? 'good' as const : 'warn' as const,
        title: `${c.user?.displayName ?? 'Un organisateur'} ${c.status === 'paid' ? 'achète' : 'commande'} ${c.credits} crédit${c.credits > 1 ? 's' : ''}`,
        detail: `${money(c.amountXof)} · ${c.status === 'paid' ? 'payé' : 'en attente'}`,
      })),
      recentTournaments.map((t) => ({
        type: 'tournament' as const, ts: t.createdAt.getTime(), tone: 'info' as const,
        title: `Tournoi créé : ${t.name}`, detail: t.game ?? undefined,
      })),
      ...liveRows.map((t) => recentResults(t, since48h, 10)),
    ], 40);

    const revenueTotal = (regPaid._sum.amountXof ?? 0) + (orderPaid._sum.totalXof ?? 0) + (creditPaid._sum.amountXof ?? 0);
    return {
      now: now.getTime(),
      online,
      visitors: { total: visitsTotal, today: visitorsSeries[visitorsSeries.length - 1] ?? 0, yesterday: visitorsSeries[visitorsSeries.length - 2] ?? 0 },
      series: { days: keys, visitors: visitorsSeries, signups, registrations, orders, revenue },
      totals: { users: usersTotal, tournaments: tournamentsTotal, registrations: registrationsTotal, orders: ordersTotal, products: productsTotal, revenue: revenueTotal },
      tournaments: { live: statusCount(tournamentsByStatus as never, 'LIVE'), draft: statusCount(tournamentsByStatus as never, 'DRAFT'), finished: statusCount(tournamentsByStatus as never, 'FINISHED') },
      events: { published: statusCount(eventsByStatus as never, 'PUBLISHED'), draft: statusCount(eventsByStatus as never, 'DRAFT') },
      todo: { pendingRegistrations, pendingOrders, organizersPending, lowStock, outOfStock },
      live: liveRows.map(liveSummary).sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0)),
      activity,
      sessionSecretConfigured: SESSION_SECRET_CONFIGURED,
    };
  }
}
