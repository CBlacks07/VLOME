import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Engine from '@vlome/engine';

const FORMAT_LABEL: Record<string, string> = {
  SURVIVAL: 'Survival', SINGLE_ELIM: 'Bracket simple', DOUBLE_ELIM: 'Double élim',
  SWISS: 'Swiss', ROUND_ROBIN: 'Round Robin', POOLS: 'Poules', BATTLE_ROYALE: 'Battle Royale',
};

export interface CreateTournamentDto {
  name: string;
  game?: string;
  format?: string;
  place?: string;
  date?: string;
  nbPools?: number;
  pointsPerPlayer?: number;
  players?: string[];
}

@Injectable()
export class TournamentsService {
  constructor(private prisma: PrismaService) {}

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

  async create(dto: CreateTournamentDto) {
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
        engineState: JSON.parse(JSON.stringify(t)),
      },
    });
    return this.toCard(r);
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
}

function gen(n: number): string[] {
  return Array.from({ length: n }, (_, i) => 'Joueur ' + (i + 1));
}
