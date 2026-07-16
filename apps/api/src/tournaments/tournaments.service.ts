import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Engine from '@vlome/engine';
import { CreateTournamentDto, ReportDto, UpdateTournamentDto } from './tournaments.dto';
import { JwtUser } from '../common/jwt-auth.guard';

const FORMAT_LABEL: Record<string, string> = {
  SURVIVAL: 'Survival', SINGLE_ELIM: 'Bracket simple', DOUBLE_ELIM: 'Double élim',
  SWISS: 'Swiss', ROUND_ROBIN: 'Round Robin', POOLS: 'Poules', BATTLE_ROYALE: 'Battle Royale',
};

@Injectable()
export class TournamentsService {
  constructor(private prisma: PrismaService) {}

  // Seul le propriétaire (ou un ADMIN) peut piloter/éditer. Les tournois sans
  // propriétaire (démo) sont pilotables par tout utilisateur authentifié.
  private assertCanManage(record: { createdById: string | null }, user: JwtUser) {
    if (record.createdById && record.createdById !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('Seul l\'organisateur peut gérer ce tournoi.');
    }
  }

  /** Carte pour le listing (dérive joueurs/cagnotte depuis l'état du moteur). */
  private toCard(r: {
    id: string; name: string; game: string | null; format: string; status: string;
    date: Date | null; place: string | null; pointsPerPlayer: number; engineState: unknown;
  }) {
    const st = r.engineState as { players?: unknown[] } | null;
    const players = st && Array.isArray(st.players) ? st.players.length : 0;
    return {
      id: r.id,
      name: r.name,
      game: r.game || '',
      format: FORMAT_LABEL[r.format] || r.format,
      live: r.status === 'LIVE',
      status: r.status === 'FINISHED' ? 'Terminé' : r.status === 'LIVE' ? '' : 'À venir',
      date: r.date ? new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '',
      place: r.place || '',
      players,
      cagnotte: players * r.pointsPerPlayer,
    };
  }

  async findAll() {
    const rows = await this.prisma.tournament.findMany({ orderBy: { createdAt: 'desc' } });
    return rows
      .map((r) => this.toCard(r))
      .sort((a, b) => Number(b.live) - Number(a.live)); // les tournois en direct d'abord
  }

  async findOne(id: string) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) return null;
    return { ...this.toCard(r), engine: r.engineState ?? null };
  }

  async create(dto: CreateTournamentDto, userId?: string) {
    const t = Engine.newTournament({
      name: dto.name, game: dto.game, place: dto.place,
      nbPools: dto.nbPools ?? 2, pointsPerPlayer: dto.pointsPerPlayer ?? 5,
    });
    Engine.setPlayers(t, dto.players ?? []);
    const r = await this.prisma.tournament.create({
      data: {
        name: dto.name, game: dto.game ?? null, format: (dto.format ?? 'SURVIVAL') as any,
        status: 'DRAFT', place: dto.place ?? null, date: dto.date ? new Date(dto.date) : null,
        pointsPerPlayer: dto.pointsPerPlayer ?? 5, nbPools: dto.nbPools ?? 2,
        engineState: JSON.parse(JSON.stringify(t)), createdById: userId ?? null,
      },
    });
    return this.toCard(r);
  }

  async update(id: string, dto: UpdateTournamentDto, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim() || r.name;
    if (dto.game !== undefined) data.game = dto.game.trim() || null;
    if (dto.place !== undefined) data.place = dto.place.trim() || null;
    if (dto.date !== undefined) data.date = dto.date ? new Date(dto.date) : null;
    const upd = await this.prisma.tournament.update({ where: { id }, data });
    return this.toCard(upd);
  }

  async remove(id: string, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    await this.prisma.match.deleteMany({ where: { tournamentId: id } });
    await this.prisma.tournament.delete({ where: { id } });
    return { deleted: true };
  }

  /** Insère des tournois de démonstration si la table est vide. */
  async seed() {
    const count = await this.prisma.tournament.count();
    if (count > 0) return { seeded: false, count };

    const demos: Array<CreateTournamentDto & { status: string; live?: boolean }> = [
      { name: 'Survival Cup · Lomé', game: 'EA FC 26', format: 'SURVIVAL', place: 'Lomé', date: '2026-07-12', pointsPerPlayer: 5, players: gen(32), status: 'LIVE' },
      { name: 'Tekken Kings Cup', game: 'Tekken 8', format: 'DOUBLE_ELIM', place: 'Lomé', date: '2026-07-19', pointsPerPlayer: 5, players: gen(24), status: 'DRAFT' },
      { name: 'Free Fire Togo Series', game: 'Free Fire', format: 'BATTLE_ROYALE', place: 'Kara', date: '2026-07-26', pointsPerPlayer: 5, players: gen(48), status: 'LIVE' },
      { name: 'Valorant Lomé Open', game: 'Valorant', format: 'ROUND_ROBIN', place: 'Lomé', date: '2026-08-02', pointsPerPlayer: 5, players: gen(16), status: 'DRAFT' },
      { name: 'eFootball Coupe Kara', game: 'eFootball', format: 'POOLS', place: 'Kara', date: '2026-06-28', pointsPerPlayer: 5, players: gen(24), status: 'FINISHED' },
      { name: 'Mortal Kombat Bash', game: 'MK1', format: 'SINGLE_ELIM', place: 'Sokodé', date: '2026-08-09', pointsPerPlayer: 5, players: gen(12), status: 'DRAFT' },
      { name: 'Street Fighter 6 Rumble', game: 'Street Fighter 6', format: 'SWISS', place: 'Lomé', date: '2026-08-16', pointsPerPlayer: 5, players: gen(20), status: 'DRAFT' },
    ];

    for (const d of demos) {
      const t = Engine.newTournament({ name: d.name, game: d.game, place: d.place, nbPools: d.nbPools ?? 2, pointsPerPlayer: d.pointsPerPlayer ?? 5 });
      Engine.setPlayers(t, d.players ?? []);
      await this.prisma.tournament.create({
        data: {
          name: d.name, game: d.game ?? null, format: (d.format ?? 'SURVIVAL') as any, status: d.status as any,
          place: d.place ?? null, date: d.date ? new Date(d.date) : null,
          pointsPerPlayer: d.pointsPerPlayer ?? 5, nbPools: d.nbPools ?? 2, engineState: JSON.parse(JSON.stringify(t)),
        },
      });
    }
    return { seeded: true, count: demos.length };
  }

  /* ---------- Pilotage (état du moteur persisté) ---------- */

  private async loadEngine(id: string): Promise<{ record: { id: string; createdById: string | null }; t: Engine.Tournament } | null> {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r || !r.engineState) return null;
    return { record: r, t: r.engineState as unknown as Engine.Tournament };
  }

  private dbStatus(t: Engine.Tournament): 'DRAFT' | 'LIVE' | 'FINISHED' {
    return t.status === 'finished' ? 'FINISHED' : t.status === 'live' ? 'LIVE' : 'DRAFT';
  }

  private async persist(id: string, t: Engine.Tournament) {
    await this.prisma.tournament.update({
      where: { id },
      data: { engineState: JSON.parse(JSON.stringify(t)), status: this.dbStatus(t) as any },
    });
  }

  private poolRanking(t: Engine.Tournament, pool: Engine.Pool) {
    const wins: Record<string, number> = {};
    t.log.filter((l) => l.poolId === pool.id).forEach((l) => { wins[l.winner] = (wins[l.winner] || 0) + 1; });
    return pool.playerIds.slice()
      .sort((a, b) => (t.points[b] || 0) - (t.points[a] || 0) || (wins[b] || 0) - (wins[a] || 0))
      .map((pid) => ({ id: pid, name: Engine.playerName(t, pid), pts: t.points[pid] || 0, wins: wins[pid] || 0 }));
  }

  /** DTO « cockpit » : match courant, classement par poule, bracket finale. */
  private toState(id: string, t: Engine.Tournament) {
    const pools = t.pools.map((p) => {
      const m = Engine.currentMatch(p);
      return {
        id: p.id, name: p.name, phase: p.phase, done: p.phase === 'done',
        top1: p.top1 ? Engine.playerName(t, p.top1) : null,
        top2: p.top2 ? Engine.playerName(t, p.top2) : null,
        current: m && m.a && m.b
          ? { poolId: p.id, aId: m.a, bId: m.b, aName: Engine.playerName(t, m.a), bName: Engine.playerName(t, m.b), stage: m.stage, streak: m.streak }
          : null,
        ranking: this.poolRanking(t, p),
      };
    });
    let finals: unknown = null;
    if (t.finals) {
      const total = t.finals.rounds.length;
      finals = {
        champion: t.champion ? Engine.playerName(t, t.champion) : null,
        rounds: t.finals.rounds.map((round, r) => ({
          label: this.roundLabel(r, total),
          matches: round.map((mm) => ({
            matchId: mm.id, bye: mm.bye,
            aName: mm.a ? Engine.playerName(t, mm.a) : null, bName: mm.b ? Engine.playerName(t, mm.b) : null,
            aId: mm.a, bId: mm.b, winnerId: mm.winner,
            playable: !!(mm.a && mm.b && !mm.winner && !mm.bye),
          })),
        })),
      };
    }
    return {
      id, name: t.name, game: t.game || '', status: t.status,
      champion: t.champion ? Engine.playerName(t, t.champion) : null,
      cagnotte: Engine.cagnotte(t), distributed: Engine.distributed(t),
      allPoolsDone: Engine.allPoolsDone(t),
      pools, finals,
    };
  }

  private roundLabel(r: number, total: number) {
    const fe = total - r;
    return fe === 1 ? 'Finale' : fe === 2 ? 'Demi-finales' : fe === 3 ? 'Quarts' : '1/' + Math.pow(2, fe - 1);
  }

  async getState(id: string) {
    const l = await this.loadEngine(id);
    return l ? this.toState(id, l.t) : null;
  }

  async launch(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const { t } = l;
    if (!t.pools.length) { Engine.distributePools(t); t.pools.forEach((p) => (p.order = p.playerIds.slice())); }
    Engine.launch(t);
    await this.persist(id, t);
    return this.toState(id, t);
  }

  async startFinals(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    Engine.startFinals(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t);
  }

  async report(id: string, dto: ReportDto, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const { t } = l;
    const sa = dto.scoreA ?? 0, sb = dto.scoreB ?? 0;
    if (dto.matchId) Engine.reportFinals(t, dto.matchId, dto.winnerId ?? '', sa, sb);
    else if (dto.poolId) Engine.reportResult(t, dto.poolId, dto.winnerId ?? '', sa, sb);
    await this.persist(id, t);
    return this.toState(id, t);
  }
}

function gen(n: number): string[] {
  return Array.from({ length: n }, (_, i) => 'Joueur ' + (i + 1));
}
