import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Engine from '@vlome/engine';
import { CreateTournamentDto, RegisterDto, ReportDto, UpdateTournamentDto } from './tournaments.dto';
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
    imageUrl?: string | null; entryFeeXof?: number;
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
      imageUrl: r.imageUrl || null,
      entryFeeXof: r.entryFeeXof ?? 0,
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
    const hasScoring = [dto.survWin, dto.loserWin, dto.poolFinalWin, dto.finalsWin, dto.championBonus].some((v) => v !== undefined);
    const t = Engine.newTournament({
      name: dto.name, game: dto.game, place: dto.place,
      nbPools: dto.nbPools ?? 2, pointsPerPlayer: dto.pointsPerPlayer ?? 5,
      ...(hasScoring ? {
        scoring: {
          survWin: dto.survWin ?? 1, loserWin: dto.loserWin ?? 0.5, poolFinalWin: dto.poolFinalWin ?? 1.5,
          finalsWin: dto.finalsWin ?? 2, championBonus: dto.championBonus ?? 3,
        },
      } : {}),
    });
    Engine.setPlayers(t, dto.players ?? []);
    const r = await this.prisma.tournament.create({
      data: {
        name: dto.name, game: dto.game ?? null, format: (dto.format ?? 'SURVIVAL') as any,
        status: 'DRAFT', place: dto.place ?? null, date: dto.date ? new Date(dto.date) : null,
        pointsPerPlayer: dto.pointsPerPlayer ?? 5, nbPools: dto.nbPools ?? 2,
        imageUrl: dto.imageUrl || null, entryFeeXof: dto.entryFeeXof ?? 0,
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
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl || null;
    if (dto.entryFeeXof !== undefined) data.entryFeeXof = dto.entryFeeXof;

    // Poules/points par joueur : pilotent directement le moteur (cagnotte, répartition
    // des poules) — modifiables uniquement tant que le tournoi n'est pas lancé, sinon
    // on romprait des poules déjà constituées ou une cagnotte déjà partiellement distribuée.
    if (dto.nbPools !== undefined || dto.pointsPerPlayer !== undefined) {
      if (r.status !== 'DRAFT') throw new ConflictException('Les poules et les points par joueur ne sont modifiables qu\'avant le lancement du tournoi.');
      if (dto.nbPools !== undefined) data.nbPools = dto.nbPools;
      if (dto.pointsPerPlayer !== undefined) data.pointsPerPlayer = dto.pointsPerPlayer;
      const t = r.engineState as unknown as Engine.Tournament;
      if (dto.nbPools !== undefined) t.nbPools = dto.nbPools;
      if (dto.pointsPerPlayer !== undefined) t.pointsPerPlayer = dto.pointsPerPlayer;
      data.engineState = JSON.parse(JSON.stringify(t));
    }

    const upd = await this.prisma.tournament.update({ where: { id }, data });
    return this.toCard(upd);
  }

  /** Tournois créés par l'utilisateur (espace organisateur). */
  async mine(user: JwtUser) {
    const rows = await this.prisma.tournament.findMany({
      where: { createdById: user.sub },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toCard(r));
  }

  /**
   * Classement par jeu : agrège les résultats réels (points, victoires, titres) de
   * tous les tournois, poule par poule, joueur par joueur — aucune donnée inventée
   * (pas d'ELO ni de winrate fictifs, tout vient de l'état du moteur).
   * Un même joueur peut apparaître une fois par jeu : les stats ne sont jamais
   * mélangées entre jeux différents (un point en Free Fire n'a rien à voir avec
   * un point en Tekken 8).
   */
  async leaderboard() {
    const tournaments = await this.prisma.tournament.findMany({
      select: { id: true, game: true, engineState: true },
    });
    type Agg = { name: string; game: string; points: number; wins: number; matches: number; championships: number; tournaments: Set<string> };
    const agg = new Map<string, Agg>();
    for (const t of tournaments) {
      const st = t.engineState as unknown as Engine.Tournament | null;
      if (!st || !st.players?.length) continue;
      const game = t.game || 'Autre';
      for (const p of st.players) {
        const key = `${p.name}||${game}`;
        const entry = agg.get(key) ?? { name: p.name, game, points: 0, wins: 0, matches: 0, championships: 0, tournaments: new Set() };
        const points = st.points?.[p.id] || 0;
        const matches = st.log.filter((l) => l.a === p.id || l.b === p.id).length;
        const wins = st.log.filter((l) => l.winner === p.id).length;
        entry.points += points; entry.wins += wins; entry.matches += matches;
        if (st.champion === p.id) entry.championships++;
        if (matches > 0) entry.tournaments.add(t.id);
        agg.set(key, entry);
      }
    }

    // Ville/club best-effort : depuis le profil de l'utilisateur inscrit sous ce nom (si connu).
    const regs = await this.prisma.registration.findMany({ include: { user: { select: { city: true } } } });
    const cityByName = new Map<string, string>();
    for (const r of regs) if (r.user.city && !cityByName.has(r.playerName)) cityByName.set(r.playerName, r.user.city);

    return Array.from(agg.values())
      .filter((e) => e.matches > 0)
      .map((e) => ({
        name: e.name,
        game: e.game,
        points: Math.round(e.points * 10) / 10,
        wins: e.wins,
        losses: e.matches - e.wins,
        matches: e.matches,
        winrate: e.matches ? Math.round((e.wins / e.matches) * 100) : 0,
        championships: e.championships,
        tournamentsPlayed: e.tournaments.size,
        city: cityByName.get(e.name) || null,
      }))
      .sort((a, b) => b.points - a.points || b.winrate - a.winrate)
      .slice(0, 300);
  }

  /**
   * Inscription d'un joueur connecté à un tournoi non lancé.
   * Gratuit (entryFeeXof = 0) : ajouté immédiatement au moteur.
   * Payant : inscription en attente de paiement (playerName réservé, pas encore dans le moteur)
   * — un organisateur/admin confirme ensuite via confirmPayment().
   */
  async register(id: string, user: JwtUser, dto: RegisterDto) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    if (r.status !== 'DRAFT') throw new ConflictException('Les inscriptions sont closes : le tournoi a démarré.');
    const existing = await this.prisma.registration.findUnique({
      where: { userId_tournamentId: { userId: user.sub, tournamentId: id } },
    });
    if (existing) throw new ConflictException('Tu es déjà inscrit à ce tournoi.');

    const u = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!u) throw new NotFoundException('Utilisateur introuvable');

    const fee = r.entryFeeXof || 0;
    if (fee > 0 && !dto.paymentMethod) {
      throw new BadRequestException('Choisis un moyen de paiement pour finaliser ton inscription.');
    }

    const t = (r.engineState ?? Engine.newTournament({ name: r.name })) as Engine.Tournament;
    // Nom réservé : distinct des joueurs déjà dans le moteur ET des autres inscriptions (payées ou en attente).
    const allRegs = await this.prisma.registration.findMany({ where: { tournamentId: id }, select: { playerName: true } });
    const taken = new Set([...t.players.map((p) => p.name.toLowerCase()), ...allRegs.map((x) => x.playerName.toLowerCase())]);
    let playerName = u.displayName.trim() || u.email.split('@')[0];
    if (taken.has(playerName.toLowerCase())) {
      let n = 2;
      while (taken.has(`${playerName} (${n})`.toLowerCase())) n++;
      playerName = `${playerName} (${n})`;
    }

    if (fee === 0) {
      // Gratuit : ajouté tout de suite.
      t.players.push({ id: Engine.uid(), name: playerName, club: u.city || '' });
      await this.prisma.$transaction([
        this.prisma.registration.create({ data: { userId: user.sub, tournamentId: id, playerName, amountXof: 0, paymentStatus: 'paid' } }),
        this.prisma.tournament.update({ where: { id }, data: { engineState: JSON.parse(JSON.stringify(t)) } }),
      ]);
      return { registered: true, pending: false, playerName, amountXof: 0, players: t.players.length };
    }

    // Payant : réservé, en attente de confirmation (voir confirmPayment).
    await this.prisma.registration.create({
      data: { userId: user.sub, tournamentId: id, playerName, amountXof: fee, paymentMethod: dto.paymentMethod, paymentStatus: 'pending' },
    });
    return { registered: true, pending: true, playerName, amountXof: fee };
  }

  /** Confirme le paiement d'une inscription en attente (organisateur/admin) et ajoute le joueur au moteur. */
  async confirmPayment(tournamentId: string, registrationId: string, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    const reg = await this.prisma.registration.findUnique({ where: { id: registrationId } });
    if (!reg || reg.tournamentId !== tournamentId) throw new NotFoundException('Inscription introuvable');
    if (reg.paymentStatus === 'paid') throw new ConflictException('Ce paiement est déjà confirmé.');
    if (r.status !== 'DRAFT') throw new ConflictException('Le tournoi a déjà démarré.');

    const t = (r.engineState ?? Engine.newTournament({ name: r.name })) as Engine.Tournament;
    t.players.push({ id: Engine.uid(), name: reg.playerName, club: '' });

    await this.prisma.$transaction([
      this.prisma.registration.update({ where: { id: registrationId }, data: { paymentStatus: 'paid' } }),
      this.prisma.tournament.update({ where: { id: tournamentId }, data: { engineState: JSON.parse(JSON.stringify(t)) } }),
    ]);
    return { confirmed: true, playerName: reg.playerName, players: t.players.length };
  }

  /** Liste des inscriptions (payées + en attente) — organisateur/admin, pour le cockpit. */
  async listRegistrations(tournamentId: string, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    const regs = await this.prisma.registration.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true, displayName: true } } },
    });
    return regs.map((x) => ({
      id: x.id, playerName: x.playerName, amountXof: x.amountXof,
      paymentMethod: x.paymentMethod, paymentStatus: x.paymentStatus,
      userEmail: x.user.email, userDisplayName: x.user.displayName,
      createdAt: x.createdAt,
    }));
  }

  /** Désinscription (tant que le tournoi n'a pas démarré). */
  async unregister(id: string, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    if (r.status !== 'DRAFT') throw new ConflictException('Le tournoi a démarré : désinscription impossible.');
    const reg = await this.prisma.registration.findUnique({
      where: { userId_tournamentId: { userId: user.sub, tournamentId: id } },
    });
    if (!reg) throw new NotFoundException('Tu n\'es pas inscrit à ce tournoi.');

    const t = r.engineState as Engine.Tournament | null;
    if (t) t.players = t.players.filter((p) => p.name !== reg.playerName);

    await this.prisma.$transaction([
      this.prisma.registration.delete({ where: { id: reg.id } }),
      this.prisma.tournament.update({
        where: { id },
        data: t ? { engineState: JSON.parse(JSON.stringify(t)) } : {},
      }),
    ]);
    return { registered: false, players: t ? t.players.length : 0 };
  }

  /** Tournois où l'utilisateur est inscrit, avec le statut de paiement (pour l'affichage). */
  async registrationIds(user: JwtUser) {
    const regs = await this.prisma.registration.findMany({
      where: { userId: user.sub },
      select: { tournamentId: true, paymentStatus: true, amountXof: true },
    });
    return regs.map((x) => ({ id: x.tournamentId, status: x.paymentStatus, amountXof: x.amountXof }));
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
      // Rend l'état cohérent : les LIVE sont lancés & partiellement joués, les FINISHED joués jusqu'au champion.
      if (d.status === 'LIVE' || d.status === 'FINISHED') {
        Engine.distributePools(t);
        t.pools.forEach((p) => (p.order = p.playerIds.slice()));
        Engine.launch(t);
        let guard = 0;
        const full = d.status === 'FINISHED';
        while (!Engine.allPoolsDone(t) && guard++ < 800) {
          let acted = false;
          for (const pool of t.pools) { const m = Engine.currentMatch(pool); if (m) { Engine.reportResult(t, pool.id, m.a); acted = true; break; } }
          if (!acted) break;
          if (!full && guard >= 4) break; // LIVE : quelques matchs seulement
        }
        if (full) {
          Engine.startFinals(t);
          guard = 0;
          while (t.status !== 'finished' && guard++ < 80) {
            let acted = false;
            for (const r of t.finals!.rounds) for (const m of r) if (m.a && m.b && !m.winner && !m.bye) { Engine.reportFinals(t, m.id, m.a); acted = true; }
            if (!acted) break;
          }
        }
      }
      const dbStatus = t.status === 'finished' ? 'FINISHED' : t.status === 'live' ? 'LIVE' : 'DRAFT';
      await this.prisma.tournament.create({
        data: {
          name: d.name, game: d.game ?? null, format: (d.format ?? 'SURVIVAL') as any, status: dbStatus as any,
          place: d.place ?? null, date: d.date ? new Date(d.date) : null,
          pointsPerPlayer: d.pointsPerPlayer ?? 5, nbPools: d.nbPools ?? 2, engineState: JSON.parse(JSON.stringify(t)),
        },
      });
    }
    return { seeded: true, count: demos.length };
  }

  /* ---------- Pilotage (état du moteur persisté) ---------- */

  private async loadEngine(id: string): Promise<{ record: { id: string; createdById: string | null; entryFeeXof: number; imageUrl: string | null; format: string; place: string | null; date: Date | null }; t: Engine.Tournament } | null> {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r || !r.engineState) return null;
    const t = r.engineState as unknown as Engine.Tournament;
    // Compat : tournois créés avant l'ajout de la disqualification (champ absent en base).
    if (!t.disqualified) t.disqualified = [];
    return { record: r, t };
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
  private toState(
    id: string, t: Engine.Tournament, entryFeeXof = 0, imageUrl: string | null = null,
    format: string | null = null, place: string | null = null, date: Date | null = null,
  ) {
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
      players: t.players.map((p) => ({ id: p.id, name: p.name, club: p.club, disqualified: t.disqualified.includes(p.id) })),
      nbPools: t.nbPools,
      pointsPerPlayer: t.pointsPerPlayer,
      entryFeeXof,
      imageUrl,
      format: format ? (FORMAT_LABEL[format] || format) : null,
      place,
      date: date ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null,
      pools, finals,
    };
  }

  private roundLabel(r: number, total: number) {
    const fe = total - r;
    return fe === 1 ? 'Finale' : fe === 2 ? 'Demi-finales' : fe === 3 ? 'Quarts' : '1/' + Math.pow(2, fe - 1);
  }

  async getState(id: string) {
    const l = await this.loadEngine(id);
    return l ? this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date) : null;
  }

  async launch(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const { t } = l;
    if (!t.pools.length) { Engine.distributePools(t); t.pools.forEach((p) => (p.order = p.playerIds.slice())); }
    Engine.launch(t);
    await this.persist(id, t);
    return this.toState(id, t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date);
  }

  async startFinals(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    Engine.startFinals(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date);
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
    return this.toState(id, t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date);
  }

  /** Ajout manuel d'un joueur par l'organisateur/admin — uniquement avant le lancement. */
  async addPlayer(id: string, name: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a démarré : impossible d\'ajouter un joueur.');
    const p = Engine.addPlayer(l.t, name);
    if (!p) throw new BadRequestException('Nom invalide ou déjà utilisé dans ce tournoi.');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date);
  }

  /** Retrait d'un joueur par l'organisateur/admin — uniquement avant le lancement. */
  async removePlayer(id: string, playerId: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a démarré : impossible de retirer un joueur.');
    if (!Engine.removePlayer(l.t, playerId)) throw new NotFoundException('Joueur introuvable.');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date);
  }

  /** Disqualification en direct — forfait immédiat, l'adversaire est déclaré vainqueur. */
  async disqualifyPlayer(id: string, playerId: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const res = Engine.disqualifyPlayer(l.t, playerId);
    if (!res.ok) {
      if (res.reason === 'not-live') throw new ConflictException('La disqualification n\'est possible que pendant un tournoi en direct.');
      if (res.reason === 'already-disqualified') throw new ConflictException('Ce joueur est déjà disqualifié.');
      throw new NotFoundException('Joueur introuvable.');
    }
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date);
  }
}

function gen(n: number): string[] {
  return Array.from({ length: n }, (_, i) => 'Joueur ' + (i + 1));
}
