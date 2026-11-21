import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeElo, ELO_START } from './elo';
import type { EloMatch } from './elo';
import * as Engine from '@vlome/engine';
import * as ExcelJS from 'exceljs';
import { CorrectResultDto, CreateTournamentDto, RegisterDto, ReportDto, UpdateTournamentDto } from './tournaments.dto';
import { JwtUser } from '../common/jwt-auth.guard';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CreditsService } from '../credits/credits.service';
import { LoyaltyReason } from '../../generated/prisma';
import { MailService, escapeHtml } from '../mail/mail.service';
import { DEFAULT_PREDICTIONS_SETTINGS, DEFAULT_TIER_POINTS_SETTINGS } from '../common/settings-defaults';

const FORMAT_LABEL: Record<string, string> = {
  SURVIVAL: 'Survival', SINGLE_ELIM: 'Bracket simple', DOUBLE_ELIM: 'Double élim',
  SWISS: 'Swiss', ROUND_ROBIN: 'Round Robin', POOLS: 'Poules', BATTLE_ROYALE: 'Battle Royale',
};

/** Étiquette de format (stockée en base, purement cosmétique historiquement) → format réel piloté par le moteur. */
const DB_TO_ENGINE_FORMAT: Record<string, Engine.TournamentFormat> = {
  SURVIVAL: 'survival', POOLS: 'survival',
  SINGLE_ELIM: 'single', DOUBLE_ELIM: 'double', ROUND_ROBIN: 'roundrobin',
  SWISS: 'swiss', BATTLE_ROYALE: 'battle_royale',
};
function engineFormatFor(dbFormat: string | null | undefined): Engine.TournamentFormat {
  return DB_TO_ENGINE_FORMAT[dbFormat || 'SURVIVAL'] || 'survival';
}

@Injectable()
export class TournamentsService {
  constructor(private prisma: PrismaService, private loyalty: LoyaltyService, private credits: CreditsService, private mail: MailService) {}

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
    imageUrl?: string | null; entryFeeXof?: number; givesLoyaltyPoint?: boolean; eventId?: string | null;
    event?: { id: string; name: string; accentColor: string | null } | null; tier?: string | null; maxPlayers?: number | null;
  }) {
    const st = r.engineState as { players?: unknown[] } | null;
    const players = st && Array.isArray(st.players) ? st.players.length : 0;
    // La cagnotte (participants × points en jeu) n'existe qu'en Survival — les autres formats
    // n'ont jamais configuré pointsPerPlayer (valeur par défaut envoyée mais jamais consultée),
    // l'afficher aurait fait croire à un budget de points qui ne s'applique pas à ce tournoi.
    const isSurvival = engineFormatFor(r.format) === 'survival';
    return {
      id: r.id,
      name: r.name,
      game: r.game || '',
      format: FORMAT_LABEL[r.format] || r.format,
      mainFormat: engineFormatFor(r.format),
      live: r.status === 'LIVE',
      status: r.status === 'FINISHED' ? 'Terminé' : r.status === 'LIVE' ? '' : 'À venir',
      date: r.date ? new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '',
      // Date brute (ISO), en plus du libellé ci-dessus déjà utilisé partout ailleurs : sert au calendrier
      // jour par jour de la page événement (regroupement + détection du jour passé), qui a besoin d'une
      // vraie date à comparer, pas d'un libellé sans année déjà mis en forme pour l'affichage.
      dateISO: r.date ? new Date(r.date).toISOString() : null,
      place: r.place || '',
      players,
      cagnotte: isSurvival ? players * r.pointsPerPlayer : null,
      imageUrl: r.imageUrl || null,
      entryFeeXof: r.entryFeeXof ?? 0,
      givesLoyaltyPoint: r.givesLoyaltyPoint ?? true,
      tier: r.tier === 'ELITE' || r.tier === 'AMATEUR' ? r.tier : null,
      maxPlayers: r.maxPlayers ?? null,
      eventId: r.eventId ?? null,
      // Événement auquel ce tournoi est rattaché (badge sur la carte) — seulement s'il est publié :
      // findAll() ne renvoie de toute façon que ces tournois-là, mais cardsByEvent()/mine() incluent
      // aussi les tournois d'événements en brouillon, où le badge n'aurait pas de page à ouvrir.
      event: r.event && r.event.name ? { id: r.event.id, name: r.event.name, accentColor: r.event.accentColor } : null,
    };
  }

  /** Cartes des tournois d'un événement (les brouillons uniquement pour ceux qui le gèrent). */
  async cardsByEvent(eventId: string) {
    const rows = await this.prisma.tournament.findMany({ where: { eventId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((r) => this.toCard(r));
  }

  /** Liste publique : cache les tournois programmés dans un événement encore en brouillon (l'événement
   * n'est pas prêt à être montré, ses tournois ne devraient pas « fuiter » avant lui) — un tournoi sans
   * événement, ou dont l'événement est publié, reste visible normalement. */
  async findAll() {
    const rows = await this.prisma.tournament.findMany({
      where: { OR: [{ eventId: null }, { event: { status: 'PUBLISHED' } }] },
      orderBy: { createdAt: 'desc' },
      include: { event: { select: { id: true, name: true, accentColor: true, status: true } } },
    });
    return rows
      .map((r) => this.toCard(r))
      .sort((a, b) => Number(b.live) - Number(a.live)); // les tournois en direct d'abord
  }

  async findOne(id: string) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) return null;
    return { ...this.toCard(r), engine: r.engineState ?? null };
  }

  async create(dto: CreateTournamentDto, user?: JwtUser) {
    const userId = user?.sub;
    // Seul un ORGANIZER (pas un ADMIN, qui n'est pas un client de la plateforme) est soumis à la
    // validation admin, aux plafonds fixés par l'admin, puis au crédit (tournoi gratuit à la
    // création du compte, puis 1 crédit par tournoi hébergé ensuite).
    if (user && user.role === 'ORGANIZER') {
      const u = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { organizerStatus: true, organizerMaxTournaments: true, organizerMaxPlayers: true },
      });
      if (!u || u.organizerStatus !== 'APPROVED') {
        throw new ForbiddenException(
          u?.organizerStatus === 'REJECTED'
            ? "Ta demande d'organisateur a été refusée par l'équipe Miabe."
            : "Ton compte organisateur est en attente de validation par l'équipe Miabe.",
        );
      }
      if (u.organizerMaxTournaments != null) {
        const count = await this.prisma.tournament.count({ where: { createdById: user.sub } });
        if (count >= u.organizerMaxTournaments) {
          throw new ConflictException(`Plafond de tournois atteint pour ton compte (${u.organizerMaxTournaments} maximum).`);
        }
      }
      if (u.organizerMaxPlayers != null && (dto.players?.length ?? 0) > u.organizerMaxPlayers) {
        throw new BadRequestException(`Ce tournoi dépasse le nombre maximum de participants autorisé pour ton compte (${u.organizerMaxPlayers}).`);
      }
      const can = await this.credits.canHost(user.sub);
      if (!can.ok) throw new ConflictException("Crédit organisateur insuffisant : achète des crédits pour héberger un nouveau tournoi.");
    }
    // Rattachement à un événement : l'appelant doit pouvoir gérer cet événement (propriétaire ou admin).
    let eventIdToUse: string | null = null;
    if (dto.eventId) {
      const ev = await this.prisma.event.findUnique({ where: { id: dto.eventId }, select: { id: true, createdById: true } });
      if (!ev) throw new NotFoundException('Événement introuvable.');
      if (!user || (ev.createdById && ev.createdById !== user.sub && user.role !== 'ADMIN')) {
        throw new ForbiddenException("Tu ne peux rattacher un tournoi qu'à tes propres événements.");
      }
      eventIdToUse = ev.id;
    }
    const hasScoring = [dto.survWin, dto.loserWin, dto.poolFinalWin, dto.finalsWin, dto.championBonus, dto.streakBonus].some((v) => v !== undefined);
    const t = Engine.newTournament({
      name: dto.name, game: dto.game, place: dto.place,
      nbPools: dto.nbPools ?? 2, pointsPerPlayer: dto.pointsPerPlayer ?? 5,
      format: engineFormatFor(dto.format),
      finalsFormat: dto.finalsFormat,
      poolFormat: dto.poolFormat,
      qualifyPerPool: dto.qualifyPerPool,
      streakLength: dto.streakLength,
      matchFormat: dto.matchMode ? { mode: dto.matchMode, value: dto.matchValue ?? (dto.matchMode === 'ft' ? 10 : 1) } : undefined,
      countGoalDiff: dto.countGoalDiff, tiebreakers: dto.tiebreakers,
      brPointsTable: dto.brPointsTable, brKillPoints: dto.brKillPoints,
      ...(hasScoring ? {
        scoring: {
          survWin: dto.survWin ?? 1, loserWin: dto.loserWin ?? 0.5, poolFinalWin: dto.poolFinalWin ?? 1.5,
          finalsWin: dto.finalsWin ?? 2, championBonus: dto.championBonus ?? 3, streakBonus: dto.streakBonus ?? 0,
        },
      } : {}),
    });
    Engine.setPlayers(t, dto.players ?? []);
    // Le barème doit tenir dans la cagnotte (participants × points/joueur) — calculé pour le
    // format de phase finale réellement choisi, sinon un double élim sous-budgété comme un
    // bracket simple peut distribuer largement plus de points que la cagnotte annoncée.
    // Sans joueur (tournoi créé « inscriptions ouvertes »), la cagnotte vaut 0 : rien à vérifier — le barème est réajusté à chaque inscription.
    if (t.format === 'survival' && t.players.length > 0 && !Engine.cagnotte(t).valid) {
      // Barème non précisé (création allégée : il se règle ensuite) : on l'ajuste à la cagnotte plutôt que de refuser.
      if (!hasScoring) Engine.autoFitScoring(t);
      else throw new ConflictException('Le barème de points dépasse la cagnotte disponible (participants × points/joueur) pour ce mode de phase finale.');
    }
    const r = await this.prisma.tournament.create({
      data: {
        name: dto.name, game: dto.game ?? null, format: (dto.format ?? 'SURVIVAL') as any,
        status: 'DRAFT', place: dto.place ?? null, date: dto.date ? new Date(dto.date) : null,
        pointsPerPlayer: dto.pointsPerPlayer ?? 5, nbPools: dto.nbPools ?? 2,
        imageUrl: dto.imageUrl || null, entryFeeXof: dto.entryFeeXof ?? 0,
        rules: dto.rules?.trim() || null, prize: dto.prize?.trim() || null, teamSize: dto.teamSize ?? null,
        givesLoyaltyPoint: dto.givesLoyaltyPoint ?? true,
        tier: (dto.tier ?? null) as any,
        maxPlayers: dto.maxPlayers && dto.maxPlayers > 0 ? dto.maxPlayers : null,
        eventId: eventIdToUse,
        engineState: JSON.parse(JSON.stringify(t)), createdById: userId ?? null,
      },
    });
    if (user && user.role === 'ORGANIZER') await this.credits.consumeForHosting(user.sub, r.id);
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
    if (dto.rules !== undefined) data.rules = dto.rules.trim() || null;
    if (dto.prize !== undefined) data.prize = dto.prize.trim() || null;
    if (dto.entryFeeXof !== undefined) data.entryFeeXof = dto.entryFeeXof;
    if (dto.givesLoyaltyPoint !== undefined) data.givesLoyaltyPoint = dto.givesLoyaltyPoint;
    if (dto.tier !== undefined) data.tier = dto.tier;
    if (dto.maxPlayers !== undefined) data.maxPlayers = dto.maxPlayers > 0 ? dto.maxPlayers : null;

    // Changement de format : un format différent = une structure de jeu différente (poules ou non,
    // barème ou non…), donc le moteur est reconstruit à neuf plutôt que rafistolé champ par champ.
    // Seulement tant qu'aucun match n'a été joué (DRAFT) — les participants déjà saisis, dans le
    // même ordre, sont repris tels quels (l'ordre détermine les oppositions du 1er tour).
    if (dto.format !== undefined && dto.format !== r.format) {
      if (r.status !== 'DRAFT') throw new ConflictException('Le format n\'est modifiable qu\'avant le lancement du tournoi.');
      const prev = this.applyEngineCompat(r.engineState as unknown as Engine.Tournament);
      const nbPools = dto.nbPools ?? r.nbPools;
      const pointsPerPlayer = dto.pointsPerPlayer ?? r.pointsPerPlayer;
      const hasScoring = [dto.survWin, dto.loserWin, dto.poolFinalWin, dto.finalsWin, dto.championBonus, dto.streakBonus].some((v) => v !== undefined);
      // Le renommage éventuel arrive dans le même PATCH que le changement de format : le nouvel état
      // moteur doit porter les valeurs soumises, pas celles encore en base.
      const nt = Engine.newTournament({
        name: (data.name as string) ?? r.name,
        game: ((data.game as string | null) ?? r.game) || undefined,
        place: ((data.place as string | null) ?? r.place) || undefined,
        nbPools, pointsPerPlayer,
        format: engineFormatFor(dto.format),
        finalsFormat: dto.finalsFormat,
        poolFormat: dto.poolFormat,
        qualifyPerPool: dto.qualifyPerPool,
        streakLength: dto.streakLength,
        matchFormat: dto.matchMode ? { mode: dto.matchMode, value: dto.matchValue ?? (dto.matchMode === 'ft' ? 10 : 1) } : prev?.matchFormat,
        countGoalDiff: dto.countGoalDiff ?? prev?.countGoalDiff, tiebreakers: dto.tiebreakers ?? prev?.tiebreakers,
        brPointsTable: dto.brPointsTable ?? prev?.brPointsTable, brKillPoints: dto.brKillPoints ?? prev?.brKillPoints,
        ...(hasScoring ? {
          scoring: {
            survWin: dto.survWin ?? 1, loserWin: dto.loserWin ?? 0.5, poolFinalWin: dto.poolFinalWin ?? 1.5,
            finalsWin: dto.finalsWin ?? 2, championBonus: dto.championBonus ?? 3, streakBonus: dto.streakBonus ?? 0,
          },
        } : {}),
      });
      Engine.setPlayers(nt, (prev?.players || []).map((p) => (p.club ? `${p.name} @${p.club}` : p.name)));
      if (nt.format === 'survival' && nt.players.length > 0 && !Engine.cagnotte(nt).valid) Engine.autoFitScoring(nt);
      data.format = dto.format as unknown;
      data.nbPools = nbPools;
      data.pointsPerPlayer = pointsPerPlayer;
      data.engineState = JSON.parse(JSON.stringify(nt));
      const upd = await this.prisma.tournament.update({ where: { id }, data });
      return this.toCard(upd);
    }

    // Poules/points par joueur : pilotent directement le moteur (cagnotte, répartition
    // des poules) — modifiables uniquement tant que le tournoi n'est pas lancé, sinon
    // on romprait des poules déjà constituées ou une cagnotte déjà partiellement distribuée.
    if (dto.nbPools !== undefined || dto.pointsPerPlayer !== undefined || dto.finalsFormat !== undefined || dto.poolFormat !== undefined || dto.streakLength !== undefined || dto.qualifyPerPool !== undefined || dto.matchMode !== undefined || dto.countGoalDiff !== undefined || dto.tiebreakers !== undefined || dto.brPointsTable !== undefined || dto.brKillPoints !== undefined) {
      if (r.status !== 'DRAFT') throw new ConflictException('Les poules, les points par joueur et les modes de poule/phase finale/striker ne sont modifiables qu\'avant le lancement du tournoi.');
      if (dto.nbPools !== undefined) data.nbPools = dto.nbPools;
      if (dto.pointsPerPlayer !== undefined) data.pointsPerPlayer = dto.pointsPerPlayer;
      const t = this.applyEngineCompat(r.engineState as unknown as Engine.Tournament);
      if (dto.nbPools !== undefined) t.nbPools = dto.nbPools;
      if (dto.pointsPerPlayer !== undefined) t.pointsPerPlayer = dto.pointsPerPlayer;
      if (dto.finalsFormat !== undefined) t.finalsFormat = dto.finalsFormat;
      if (dto.poolFormat !== undefined) t.poolFormat = dto.poolFormat;
      if (dto.streakLength !== undefined) t.streakLength = dto.streakLength;
      if (dto.qualifyPerPool !== undefined) t.qualifyPerPool = Engine.clampQualifyPerPool(dto.qualifyPerPool);
      if (dto.matchMode !== undefined) t.matchFormat = Engine.clampMatchFormat({ mode: dto.matchMode, value: dto.matchValue });
      if (dto.countGoalDiff !== undefined) { t.countGoalDiff = dto.countGoalDiff; if (!dto.countGoalDiff && dto.tiebreakers === undefined) t.tiebreakers = []; }
      if (dto.tiebreakers !== undefined) { t.tiebreakers = Engine.normalizeTiebreakers(dto.tiebreakers) ?? []; t.countGoalDiff = Engine.usesScoreTiebreak(t.tiebreakers); }
      if (dto.brPointsTable !== undefined) t.brPointsTable = dto.brPointsTable;
      if (dto.brKillPoints !== undefined) t.brKillPoints = dto.brKillPoints;
      // Changer les poules/le mode change le nombre de matchs programmés : réajuste le barème si besoin.
      if (t.format === 'survival' && t.players.length > 0 && !Engine.cagnotte(t).valid) Engine.autoFitScoring(t);
      this.syncMeta(t, {
        name: (data.name as string | undefined) ?? r.name,
        game: data.game !== undefined ? (data.game as string | null) : r.game,
        place: data.place !== undefined ? (data.place as string | null) : r.place,
      });
      data.engineState = JSON.parse(JSON.stringify(t));
    }

    // Nom / jeu / lieu modifiés seuls : l'état moteur en garde une copie (affichée sur la fiche) — on la met à jour aussi.
    if ((data.name !== undefined || data.game !== undefined || data.place !== undefined) && data.engineState === undefined && r.engineState) {
      const t = this.applyEngineCompat(r.engineState as unknown as Engine.Tournament);
      this.syncMeta(t, {
        name: (data.name as string | undefined) ?? r.name,
        game: data.game !== undefined ? (data.game as string | null) : r.game,
        place: data.place !== undefined ? (data.place as string | null) : r.place,
      });
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
      include: { event: { select: { id: true, name: true, accentColor: true, status: true } } },
    });
    return rows.map((r) => this.toCard(r));
  }

  /**
   * Classement par jeu : agrège les résultats réels (points, victoires, titres, ELO) de
   * tous les tournois, poule par poule, joueur par joueur — aucune donnée inventée
   * (tout vient de l'état du moteur ; l'ELO est rejoué match après match, voir elo.ts).
   * Un même joueur peut apparaître une fois par jeu : les stats ne sont jamais
   * mélangées entre jeux différents (un point en Free Fire n'a rien à voir avec
   * un point en Tekken 8).
   */
  async leaderboard() {
    return this.computeLeaderboard({});
  }

  /**
   * Classement cumulé d'un événement (comme un "circuit" start.gg) : même agrégation que leaderboard(),
   * restreinte aux tournois rattachés à cet événement — pour voir qui domine sur l'ensemble de ses
   * étapes, pas seulement sur un tournoi isolé.
   */
  async eventStandings(eventId: string) {
    return this.computeLeaderboard({ eventId });
  }

  /** Compte (userId) derrière chaque pseudo inscrit à un tournoi : clé « tournoi|pseudo ». Sert à distinguer
   * deux joueurs qui portent le même nom, dès lors qu'ils sont inscrits avec un compte (les joueurs saisis à
   * la main par l'organisateur n'ont pas de compte et restent regroupés par nom). */
  private async accountMap(): Promise<Map<string, string>> {
    const regs = await this.prisma.registration.findMany({ where: { paymentStatus: 'paid' }, select: { tournamentId: true, playerName: true, userId: true } });
    return new Map(regs.map((r) => [`${r.tournamentId}|${r.playerName}`, r.userId]));
  }

  /** Totaux réels d'un joueur, tous jeux confondus, par nom (insensible à la casse) — pour les listes qui n'ont pas de classement par jeu
   *  (base de joueurs, page d'une association). Les équipes sont ignorées. */
  async playerTotals(): Promise<Map<string, { points: number; wins: number; matches: number }>> {
    const rows = await this.computeLeaderboard({}, 100000);
    const totals = new Map<string, { points: number; wins: number; matches: number }>();
    for (const r of rows) {
      if (r.team) continue;
      const k = r.name.toLowerCase();
      const t = totals.get(k) ?? { points: 0, wins: 0, matches: 0 };
      t.points = Math.round((t.points + r.points) * 10) / 10; t.wins += r.wins; t.matches += r.matches;
      totals.set(k, t);
    }
    return totals;
  }

  /** ELO d'un joueur, jeu par jeu (par compte si `uid`, sinon par nom). 1000 pour un jeu sans match départagé. */
  async playerElos(name: string, uid?: string | null): Promise<Map<string, number>> {
    const rows = await this.computeLeaderboard({}, 100000);
    const lower = name.toLowerCase();
    const out = new Map<string, number>();
    for (const r of rows) {
      if (r.team) continue;
      if (uid ? r.userId === uid : r.name.toLowerCase() === lower) out.set(r.game, r.elo);
    }
    return out;
  }

  private async computeLeaderboard(where: { eventId?: string }, limit = 300) {
    const tournaments = await this.prisma.tournament.findMany({
      // Un tournoi sans événement compte normalement ; un tournoi rattaché à un événement encore en
      // brouillon (en préparation, pas publié) n'alimente pas le classement réel tant que l'événement
      // n'est pas publié — sinon des matchs de test/réglage avant publication fausseraient les stats
      // des vrais joueurs qui y sont inscrits.
      where: { ...where, OR: [{ eventId: null }, { event: { status: 'PUBLISHED' } }] },
      select: { id: true, game: true, engineState: true, teams: true, tier: true },
    });
    const acct = await this.accountMap();
    const { amateurMultiplier, eliteMultiplier } = await this.getTierMultipliers();
    type Agg = { team?: string[]; userId: string | null; name: string; game: string; points: number; wins: number; matches: number; championships: number; tournaments: Set<string>; eloKey: string };
    const agg = new Map<string, Agg>();
    // Matchs de chaque jeu, pour rejouer l'ELO dans l'ordre chronologique (un classement ELO par jeu, jamais mélangé).
    const eloMatches = new Map<string, EloMatch[]>();
    for (const t of tournaments) {
      const st = t.engineState as unknown as Engine.Tournament | null;
      if (!st || !st.players?.length) continue;
      const game = t.game || 'Autre';
      const teams = (t.teams as Record<string, string[]> | null) || {};
      // Palier : purement un badge par défaut (multiplicateurs à 1), mais réglable depuis Admin →
      // Paliers si l'équipe veut vraiment pondérer le classement par palier.
      const tierMult = t.tier === 'ELITE' ? eliteMultiplier : amateurMultiplier;
      // Clé ELO de chaque concurrent de CE tournoi (l'équipe en tournoi par équipes, sinon le joueur — par compte quand il y en a un).
      const eloKeyOf = new Map<string, string>();
      for (const p of st.players) {
        const uid0 = acct.get(`${t.id}|${p.name}`) ?? null;
        eloKeyOf.set(p.id, teams[p.name] ? `team:${p.name}||${game}` : `${uid0 ? 'u:' + uid0 : p.name}||${game}`);
      }
      for (const l of st.log) {
        if (!l.a || !l.b || !l.winner) continue;
        const ka = eloKeyOf.get(l.a), kb = eloKeyOf.get(l.b);
        if (!ka || !kb) continue;
        const list = eloMatches.get(game) ?? [];
        list.push({ ts: l.ts, a: ka, b: kb, winner: l.winner === l.a ? 'a' : 'b' });
        eloMatches.set(game, list);
      }
      for (const p of st.players) {
        const uid = acct.get(`${t.id}|${p.name}`) ?? null;
        const points = (st.points?.[p.id] || 0) * tierMult;
        // Un vrai duel a toujours un adversaire (b non nul) — exclut le bonus champion/les ajustements
        // manuels (b: null), qui gonfleraient sinon le nombre de matchs et de victoires du champion.
        const realMatches = st.log.filter((l) => l.a && l.b);
        const matches = realMatches.filter((l) => l.a === p.id || l.b === p.id).length;
        const wins = realMatches.filter((l) => l.winner === p.id).length;
        const champion = st.champion === p.id;
        // Tournoi par équipes : l'équipe a sa ligne (marquée « team »), et chaque membre reçoit les MÊMES stats
        // sur sa propre ligne de joueur.
        const members = teams[p.name];
        // eloKey : la clé sous laquelle l'ELO de ce concurrent est calculé (un membre d'équipe reprend l'ELO de son équipe).
        const targets: { key: string; name: string; uid: string | null; team?: string[]; eloKey: string }[] = members
          ? [{ key: `team:${p.name}||${game}`, name: p.name, uid: null, team: members, eloKey: `team:${p.name}||${game}` }, ...members.map((m) => ({ key: `${m}||${game}`, name: m, uid: null, eloKey: `team:${p.name}||${game}` }))]
          : [{ key: `${uid ? 'u:' + uid : p.name}||${game}`, name: p.name, uid, eloKey: `${uid ? 'u:' + uid : p.name}||${game}` }];
        for (const tg of targets) {
          const entry = agg.get(tg.key) ?? { team: tg.team, userId: tg.uid, name: tg.name, game, points: 0, wins: 0, matches: 0, championships: 0, tournaments: new Set(), eloKey: tg.eloKey };
          entry.points += points; entry.wins += wins; entry.matches += matches;
          if (champion) entry.championships++;
          if (matches > 0) entry.tournaments.add(t.id);
          agg.set(tg.key, entry);
        }
      }
    }

    // Ville/club best-effort : depuis le profil de l'utilisateur inscrit sous ce nom (si connu),
    // et depuis la base de joueurs (roster) pour le club — rapprochement par nom, insensible à la casse.
    const regs = await this.prisma.registration.findMany({ include: { user: { select: { city: true } } } });
    const cityByName = new Map<string, string>();
    for (const r of regs) if (r.user.city && !cityByName.has(r.playerName)) cityByName.set(r.playerName, r.user.city);

    const rosterPlayers = await this.prisma.player.findMany({ include: { club: { select: { name: true } } } });
    const clubByName = new Map<string, string>();
    for (const p of rosterPlayers) if (p.club && !clubByName.has(p.name.toLowerCase())) clubByName.set(p.name.toLowerCase(), p.club.name);

    const eloByGame = new Map<string, Map<string, number>>();
    for (const [g, list] of eloMatches) eloByGame.set(g, computeElo(list));

    return Array.from(agg.values())
      .filter((e) => e.matches > 0)
      .map((e) => ({
        userId: e.userId,
        team: e.team ?? null,
        name: e.name,
        game: e.game,
        points: Math.round(e.points * 10) / 10,
        wins: e.wins,
        losses: e.matches - e.wins,
        matches: e.matches,
        winrate: e.matches ? Math.round((e.wins / e.matches) * 100) : 0,
        // ELO réel de ce jeu (rejoué sur tous ses matchs) ; 1000 = n'a pas encore été départagé par un adversaire.
        elo: Math.round(eloByGame.get(e.game)?.get(e.eloKey) ?? ELO_START),
        championships: e.championships,
        tournamentsPlayed: e.tournaments.size,
        city: cityByName.get(e.name) || null,
        club: clubByName.get(e.name.toLowerCase()) || null,
      }))
      .sort((a, b) => b.points - a.points || b.winrate - a.winrate)
      .slice(0, limit);
  }

  /** Le concurrent (côté moteur) que désigne un nom : un joueur/une équipe du tournoi, ou — en tournoi par
   * équipes — un membre d'équipe, qui reprend alors les stats de son équipe. */
  private findEntrant(st: Engine.Tournament, teams: Record<string, string[]>, tournamentId: string, name: string, uid: string | undefined, acct: Map<string, string> | null): Engine.Player | undefined {
    const direct = st.players?.find((p) => p.name === name && (!uid || acct?.get(`${tournamentId}|${p.name}`) === uid));
    if (direct || uid) return direct;
    const lower = name.toLowerCase();
    const teamName = Object.keys(teams).find((k) => teams[k].some((m) => m.toLowerCase() === lower));
    return teamName ? st.players?.find((p) => p.name === teamName) : undefined;
  }

  /** Ville/club best-effort pour un nom de joueur — même rapprochement que leaderboard() (inscription/roster). */
  private async cityAndClubForName(name: string, uid?: string): Promise<{ city: string | null; club: string | null }> {
    const [reg, rosterPlayer] = await Promise.all([
      this.prisma.registration.findFirst({ where: uid ? { userId: uid, playerName: name } : { playerName: name }, include: { user: { select: { city: true } } } }),
      this.prisma.player.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, include: { club: { select: { name: true } } } }),
    ]);
    return { city: reg?.user.city || null, club: rosterPlayer?.club?.name || null };
  }

  /**
   * Fiche publique d'un joueur (comme le profil joueur de start.gg) : stats globales et par jeu,
   * historique des matchs joués — identifié par son nom (pas de compte requis, comme leaderboard()).
   */
  async playerProfile(name: string, uid?: string) {
    const acct = uid ? await this.accountMap() : null;
    const tournaments = await this.prisma.tournament.findMany({
      // Même garde que computeLeaderboard() : un tournoi d'un événement encore en brouillon ne doit
      // pas apparaître dans les vraies stats du joueur.
      where: { OR: [{ eventId: null }, { event: { status: 'PUBLISHED' } }] },
      select: { id: true, name: true, game: true, status: true, date: true, engineState: true, teams: true, tier: true },
    });
    const { amateurMultiplier, eliteMultiplier } = await this.getTierMultipliers();
    let points = 0, wins = 0, losses = 0, championships = 0, tournamentsPlayed = 0;
    const byGameMap = new Map<string, { game: string; points: number; wins: number; losses: number; championships: number; tournamentsPlayed: number }>();
    const history: Array<{ tournamentId: string; tournamentName: string; game: string; opponent: string; sa: number | null; sb: number | null; won: boolean; ts: number }> = [];
    for (const t of tournaments) {
      const st = t.engineState as unknown as Engine.Tournament | null;
      if (!st) continue;
      const me = this.findEntrant(st, (t.teams as Record<string, string[]> | null) || {}, t.id, name, uid, acct);
      if (!me) continue;
      const game = t.game || 'Autre';
      // Même barème que computeLeaderboard() : multiplicateur par palier, réglable en admin.
      const tPoints = (st.points?.[me.id] || 0) * (t.tier === 'ELITE' ? eliteMultiplier : amateurMultiplier);
      const logs = st.log.filter((l) => l.a && l.b && (l.a === me.id || l.b === me.id));
      const tWins = logs.filter((l) => l.winner === me.id).length;
      const tLosses = logs.length - tWins;
      const champion = st.champion === me.id;
      points += tPoints; wins += tWins; losses += tLosses; tournamentsPlayed++;
      if (champion) championships++;
      const g = byGameMap.get(game) || { game, points: 0, wins: 0, losses: 0, championships: 0, tournamentsPlayed: 0 };
      g.points += tPoints; g.wins += tWins; g.losses += tLosses; g.tournamentsPlayed++;
      if (champion) g.championships++;
      byGameMap.set(game, g);
      for (const l of logs) {
        if (!l.winner) continue;
        const oppId = l.a === me.id ? l.b : l.a;
        const opponent = Engine.playerName(st, oppId!);
        const won = l.winner === me.id;
        history.push({
          tournamentId: t.id, tournamentName: t.name, game,
          opponent, sa: l.a === me.id ? (l.sa ?? null) : (l.sb ?? null), sb: l.a === me.id ? (l.sb ?? null) : (l.sa ?? null),
          won, ts: l.ts,
        });
      }
    }
    const { city, club } = await this.cityAndClubForName(name, uid);
    const elos = await this.playerElos(name, uid);
    return {
      name, userId: uid ?? null, city, club,
      totals: { points: Math.round(points * 10) / 10, wins, losses, matches: wins + losses, winrate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0, championships, tournamentsPlayed },
      byGame: Array.from(byGameMap.values()).map((g) => ({ ...g, elo: elos.get(g.game) ?? ELO_START })).sort((a, b) => b.points - a.points),
      history: history.sort((a, b) => b.ts - a.ts).slice(0, 50),
    };
  }

  /**
   * Confrontations directes entre deux joueurs (comme le head-to-head de start.gg) — parcourt tous
   * les tournois où les deux noms apparaissent et compte les victoires l'un contre l'autre.
   */
  async headToHead(nameA: string, nameB: string, uidA?: string, uidB?: string) {
    const acct = uidA || uidB ? await this.accountMap() : null;
    const tournaments = await this.prisma.tournament.findMany({
      // Même garde que computeLeaderboard()/playerProfile() : un tournoi d'un événement encore en
      // brouillon ne doit pas peser sur une confrontation entre deux joueurs.
      where: { OR: [{ eventId: null }, { event: { status: 'PUBLISHED' } }] },
      select: { id: true, name: true, game: true, engineState: true, teams: true },
    });
    let aWins = 0, bWins = 0;
    const matches: Array<{ tournamentId: string; tournamentName: string; game: string; sa: number | null; sb: number | null; winner: 'a' | 'b'; ts: number }> = [];
    for (const t of tournaments) {
      const st = t.engineState as unknown as Engine.Tournament | null;
      if (!st) continue;
      const tms = (t.teams as Record<string, string[]> | null) || {};
      const pa = this.findEntrant(st, tms, t.id, nameA, uidA, acct);
      const pb = this.findEntrant(st, tms, t.id, nameB, uidB, acct);
      if (!pa || !pb) continue;
      const logs = st.log.filter((l) => l.a && l.b && l.winner && ((l.a === pa.id && l.b === pb.id) || (l.a === pb.id && l.b === pa.id)));
      for (const l of logs) {
        const aIsA = l.a === pa.id;
        const winner: 'a' | 'b' = l.winner === pa.id ? 'a' : 'b';
        if (winner === 'a') aWins++; else bWins++;
        matches.push({
          tournamentId: t.id, tournamentName: t.name, game: t.game || 'Autre',
          sa: aIsA ? (l.sa ?? null) : (l.sb ?? null), sb: aIsA ? (l.sb ?? null) : (l.sa ?? null),
          winner, ts: l.ts,
        });
      }
    }
    return { a: nameA, b: nameB, aWins, bWins, matches: matches.sort((x, y) => y.ts - x.ts) };
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

    // Réduction en points fidélité sur les frais d'inscription (seulement si le tournoi est payant).
    let pointsUsed = 0;
    let netFee = fee;
    if (dto.pointsToRedeem) {
      if (fee === 0) throw new BadRequestException("Ce tournoi est gratuit : rien à réduire avec des points.");
      const maxPoints = await this.loyalty.maxRedeemablePoints(user.sub, fee, fee);
      pointsUsed = Math.min(dto.pointsToRedeem, maxPoints);
      if (pointsUsed > 0) {
        const settings = await this.loyalty.getSettings();
        netFee = Math.max(0, fee - pointsUsed * settings.pointValueXof);
      }
    }

    if (netFee > 0 && !dto.paymentMethod) {
      throw new BadRequestException('Choisis un moyen de paiement pour finaliser ton inscription.');
    }

    const t = (r.engineState ?? Engine.newTournament({ name: r.name })) as Engine.Tournament;
    // Nom réservé : distinct des joueurs déjà dans le moteur ET des autres inscriptions (payées ou en attente).
    const allRegs = await this.prisma.registration.findMany({ where: { tournamentId: id }, select: { playerName: true, paymentStatus: true } });
    // Tournoi complet : les joueurs déjà dans le moteur + les paiements en attente (qui réservent leur place).
    if (r.maxPlayers) {
      const pendingSlots = allRegs.filter((x) => x.paymentStatus === 'pending').length;
      if (t.players.length + pendingSlots >= r.maxPlayers) throw new ConflictException('Ce tournoi est complet : toutes les places sont prises.');
    }
    const taken = new Set([...t.players.map((p) => p.name.toLowerCase()), ...allRegs.map((x) => x.playerName.toLowerCase())]);
    // Tournoi par équipes : le capitaine inscrit l'équipe entière — l'équipe est UN concurrent côté moteur.
    let members: string[] | null = null;
    let playerName = u.displayName.trim() || u.email.split('@')[0];
    if (r.teamSize) {
      const teamName = (dto.teamName || '').trim();
      if (teamName.length < 2) throw new BadRequestException("Donne un nom à ton équipe (2 caractères minimum).");
      members = (dto.members || []).map((m) => m.trim()).filter(Boolean);
      if (members.length !== r.teamSize) throw new BadRequestException(`Une équipe compte exactement ${r.teamSize} joueurs.`);
      if (new Set(members.map((m) => m.toLowerCase())).size !== members.length) throw new BadRequestException("Deux joueurs de l'équipe portent le même nom.");
      playerName = teamName;
    }
    if (taken.has(playerName.toLowerCase())) {
      if (r.teamSize) throw new ConflictException("Ce nom d'équipe est déjà pris dans ce tournoi.");
      let n = 2;
      while (taken.has(`${playerName} (${n})`.toLowerCase())) n++;
      playerName = `${playerName} (${n})`;
    }

    if (netFee === 0) {
      // Gratuit (ou entièrement couvert par des points) : ajouté tout de suite.
      t.players.push({ id: Engine.uid(), name: playerName, club: u.city || '' });
      const teams = members ? { ...((r.teams as Record<string, string[]>) || {}), [playerName]: members } : undefined;
      const reg = await this.prisma.$transaction(async (tx) => {
        const created = await tx.registration.create({
          data: {
            userId: user.sub, tournamentId: id, playerName, amountXof: 0, paymentStatus: 'paid',
            paymentMethod: pointsUsed > 0 ? 'Points fidélité' : null, pointsRedeemed: pointsUsed,
          },
        });
        await tx.tournament.update({ where: { id }, data: { engineState: JSON.parse(JSON.stringify(t)), ...(teams ? { teams } : {}) } });
        return created;
      });
      if (pointsUsed > 0) {
        try {
          await this.loyalty.redeem(user.sub, pointsUsed, LoyaltyReason.REGISTRATION_REDEMPTION, { registrationId: reg.id, note: r.name });
        } catch (e) {
          await this.prisma.registration.delete({ where: { id: reg.id } });
          throw e;
        }
      }
      if (r.givesLoyaltyPoint) {
        await this.loyalty.award(user.sub, 1, LoyaltyReason.PARTICIPATION, { registrationId: reg.id, note: r.name });
      }
      await this.notifyRegistration(user.sub, r.name, playerName, 0, false, r.date, r.place);
      return { registered: true, pending: false, playerName, amountXof: 0, pointsRedeemed: pointsUsed, players: t.players.length };
    }

    // Payant (au moins en partie) : réservé, en attente de confirmation (voir confirmPayment).
    const reg = await this.prisma.registration.create({
      data: {
        userId: user.sub, tournamentId: id, playerName, amountXof: netFee,
        paymentMethod: dto.paymentMethod, paymentStatus: 'pending', pointsRedeemed: pointsUsed,
      },
    });
    if (members) await this.prisma.tournament.update({ where: { id }, data: { teams: { ...((r.teams as Record<string, string[]>) || {}), [playerName]: members } } });
    if (pointsUsed > 0) {
      try {
        await this.loyalty.redeem(user.sub, pointsUsed, LoyaltyReason.REGISTRATION_REDEMPTION, { registrationId: reg.id, note: r.name });
      } catch (e) {
        await this.prisma.registration.delete({ where: { id: reg.id } });
        throw e;
      }
    }
    await this.notifyRegistration(user.sub, r.name, playerName, netFee, true, r.date, r.place);
    return { registered: true, pending: true, registrationId: reg.id, playerName, amountXof: netFee, pointsRedeemed: pointsUsed };
  }

  /** Confirmation d'inscription. Best-effort : une inscription valide ne doit pas échouer sur un e-mail. */
  private async notifyRegistration(userId: string, tournamentName: string, playerName: string, amountXof: number, pending: boolean, date: Date | null, place: string | null) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, displayName: true } });
    if (!u) return;
    const when = date ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
    await this.mail.send(
      u.email,
      `Inscription à « ${tournamentName} » — Miabe Esport`,
      this.mail.layout(
        pending ? 'Inscription réservée' : 'Inscription confirmée',
        `<p>Bonjour ${escapeHtml(u.displayName)},</p>
         <p>Ton inscription au tournoi <b>${escapeHtml(tournamentName)}</b> est enregistrée sous le pseudo <b>${escapeHtml(playerName)}</b>.</p>
         ${when || place ? `<p>${when ? `Date : <b>${when}</b>` : ''}${when && place ? ' · ' : ''}${place ? `Lieu : <b>${escapeHtml(place)}</b>` : ''}</p>` : ''}
         ${pending
           ? `<p>Montant à régler : <b>${amountXof.toLocaleString('fr-FR')} F</b>. Ta place est réservée et sera définitivement validée dès réception du paiement par l'équipe Miabe Esport.</p>`
           : `<p>Ta place est confirmée, rien de plus à faire. Bonne chance !</p>`}`,
        { label: 'Voir le tournoi', url: `${this.mail.siteUrl}/#profil` },
      ),
    );
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
    if (r.givesLoyaltyPoint) {
      await this.loyalty.award(reg.userId, 1, LoyaltyReason.PARTICIPATION, { registrationId: reg.id, note: r.name });
    }
    return { confirmed: true, playerName: reg.playerName, players: t.players.length };
  }

  /** Confirmation d'une inscription par la passerelle de paiement en ligne (aucun droit de gestion requis :
   * l'appelant a déjà vérifié la transaction auprès du prestataire). Idempotente : un second appel
   * (retour navigateur + webhook) ne réinscrit pas le joueur. */
  async confirmRegistrationPaidOnline(registrationId: string) {
    const reg = await this.prisma.registration.findUnique({ where: { id: registrationId } });
    if (!reg) throw new NotFoundException('Inscription introuvable');
    if (reg.paymentStatus === 'paid') return { confirmed: true, already: true };
    const r = await this.prisma.tournament.findUnique({ where: { id: reg.tournamentId } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    if (r.status !== 'DRAFT') throw new ConflictException('Le tournoi a déjà démarré.');
    const t = (r.engineState ?? Engine.newTournament({ name: r.name })) as Engine.Tournament;
    t.players.push({ id: Engine.uid(), name: reg.playerName, club: '' });
    await this.prisma.$transaction([
      this.prisma.registration.update({ where: { id: reg.id }, data: { paymentStatus: 'paid' } }),
      this.prisma.tournament.update({ where: { id: r.id }, data: { engineState: JSON.parse(JSON.stringify(t)) } }),
    ]);
    if (r.givesLoyaltyPoint) {
      await this.loyalty.award(reg.userId, 1, LoyaltyReason.PARTICIPATION, { registrationId: reg.id, note: r.name });
    }
    return { confirmed: true, already: false };
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
      checkedIn: !!x.checkedInAt, code: this.ticketCode(x.id),
    }));
  }

  /** Code court imprimé sous le QR code du billet (6 derniers caractères de l'identifiant d'inscription, en majuscules). */
  private ticketCode(registrationId: string) {
    return registrationId.slice(-6).toUpperCase();
  }

  /** Nom de tournoi → nom de fichier sûr (accents conservés, tout le reste réduit à des tirets). */
  private xlsxFilename(prefix: string, tournamentName: string): string {
    const slug = tournamentName.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'tournoi';
    return `${prefix}-${slug}.xlsx`;
  }

  /** Classeur Excel à une feuille, mis en forme (en-tête colorée, colonnes ajustées à leur contenu,
   * lignes zébrées) — un vrai tableur plutôt qu'un CSV brut, qu'Excel/WPS en paramètres régionaux
   * français ouvre de toute façon en une seule colonne (le séparateur y est le point-virgule). */
  private async buildSheet(sheetName: string, columns: { header: string; width?: number }[], rows: (string | number)[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Miabe Esport';
    const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, width: c.width ?? Math.max(12, c.header.length + 4) }));
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EA5B8' } };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
    header.height = 22;
    rows.forEach((r, i) => {
      const row = ws.addRow(r);
      if (i % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F6F8' } };
    });
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E5EA' } } };
      });
    });
    // Colonnes numériques (points, victoires, montants…) : ajuste la largeur au contenu réel et
    // centre — sans quoi les chiffres restent collés au bord gauche comme du texte.
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      const longest = Math.max(c.header.length, ...rows.map((r) => String(r[i] ?? '').length));
      col.width = Math.min(48, Math.max(10, longest + 3));
      if (rows.every((r) => typeof r[i] === 'number')) col.alignment = { horizontal: 'center' };
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Export Excel des inscriptions (organisateur/admin) — même contenu que listRegistrations, mis en
   * forme pour un tableur. */
  async exportRegistrationsXlsx(tournamentId: string, user: JwtUser): Promise<{ filename: string; buffer: Buffer }> {
    const r = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    const regs = await this.prisma.registration.findMany({
      where: { tournamentId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true, displayName: true } } },
    });
    const rows = regs.map((x) => [
      x.playerName, x.user.displayName, x.user.email, x.amountXof,
      x.paymentMethod || '', x.paymentStatus === 'paid' ? 'Payé' : 'En attente',
      x.checkedInAt ? 'Oui' : 'Non', this.ticketCode(x.id),
      x.createdAt.toLocaleString('fr-FR'),
    ]);
    const buffer = await this.buildSheet('Inscriptions', [
      { header: 'Joueur' }, { header: 'Compte' }, { header: 'Email', width: 26 }, { header: 'Montant (XOF)' },
      { header: 'Méthode' }, { header: 'Statut' }, { header: 'Pointé' }, { header: 'Code billet' }, { header: 'Inscrit le', width: 18 },
    ], rows);
    return { filename: this.xlsxFilename('inscriptions', r.name), buffer };
  }

  /** Export Excel du classement final (organisateur/admin) — un tableur pour archiver/partager les
   * résultats hors de l'appli, comme le permettent Challonge/start.gg. */
  async exportResultsXlsx(tournamentId: string, user: JwtUser): Promise<{ filename: string; buffer: Buffer }> {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(l.record, user);
    const t = l.t;
    const clubById = new Map(t.players.map((p) => [p.id, p.club || '']));
    const ranking = Engine.overallRanking(t);
    const rows = ranking.map((row, i) => [i + 1, row.name, clubById.get(row.id) || '', row.pts, row.wins, row.losses]);
    const buffer = await this.buildSheet('Résultats', [
      { header: 'Rang', width: 8 }, { header: 'Joueur' }, { header: 'Club' },
      { header: 'Points' }, { header: 'Victoires' }, { header: 'Défaites' },
    ], rows);
    return { filename: this.xlsxFilename('resultats', t.name), buffer };
  }

  /** Poste/table assigné à un match en cours (LAN à plusieurs postes) — purement indicatif, affiché en
   * régie et sur les écrans publics (voir toState). key = activeKey côté web (matchId ou poolId) ;
   * label vide ou omis efface l'assignation. */
  async setStation(tournamentId: string, key: string, label: string | undefined, user: JwtUser) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(l.record, user);
    const stations = { ...((l.record.stations as Record<string, string>) || {}) };
    const clean = (label || '').trim();
    if (clean) stations[key] = clean.slice(0, 40); else delete stations[key];
    await this.prisma.tournament.update({ where: { id: tournamentId }, data: { stations } });
    // Renvoie l'état complet du tournoi (comme toute autre action de régie) — sans quoi le front,
    // qui remplace tout S.detail par la réponse, se retrouverait avec un objet tronqué à { stations }.
    return this.toState(tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, stations, l.record.streamMatchKey, l.record);
  }

  /** Marque (ou démarque) le match "à l'antenne" — un seul à la fois par tournoi (voir setStation pour la clé). */
  async setStreamMatch(tournamentId: string, key: string, on: boolean, user: JwtUser) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(l.record, user);
    const streamMatchKey = on ? key : null;
    await this.prisma.tournament.update({ where: { id: tournamentId }, data: { streamMatchKey } });
    return this.toState(tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, streamMatchKey, l.record);
  }

  /* ---------- Pronostics ---------- */

  /** Matchs dont les deux concurrents sont connus et qui ne sont pas encore joués (phase finale + calendrier
   * des poules round robin) — ceux sur lesquels on peut pronostiquer. `label` = nom du tour quand il existe. */
  private predictableMatches(st: Record<string, any>): { key: string; a: string; b: string; label: string | null }[] {
    const out: { key: string; a: string; b: string; label: string | null }[] = [];
    const walk = (n: any, label: string | null): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach((x) => walk(x, label)); return; }
      if (n.matchId && n.aName && n.bName && !n.winnerId && !n.bye) { out.push({ key: n.matchId, a: n.aName, b: n.bName, label }); return; }
      const next = typeof n.label === 'string' ? n.label : label;
      Object.values(n).forEach((v) => walk(v, next));
    };
    walk(st.finals, null);
    (st.pools || []).forEach((p: any) => walk(p.rrmatches, p.name));
    return out;
  }

  /** Nom du vainqueur d'un match joué (depuis le journal), ou null s'il n'est pas encore joué. */
  private winnerOf(t: Engine.Tournament, matchKey: string): string | null {
    const l = t.log.find((e) => e.matchId === matchKey && e.winner && e.a && e.b);
    return l ? Engine.playerName(t, l.winner!) : null;
  }

  /** Barème des pronostics — réglable depuis Admin → Pronostics (Setting générique, clé "predictions"). */
  private async getPredictionSettings(): Promise<{ basePoints: number; outsiderThreshold: number; outsiderMultiplier: number }> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'predictions' } });
    return { ...DEFAULT_PREDICTIONS_SETTINGS, ...(row?.value as object) };
  }

  /** Multiplicateur de points de classement par palier — réglable depuis Admin → Paliers (Setting
   * générique, clé "tierPoints"). Un tournoi sans palier suit le multiplicateur Amateur. */
  private async getTierMultipliers(): Promise<{ amateurMultiplier: number; eliteMultiplier: number }> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'tierPoints' } });
    return { ...DEFAULT_TIER_POINTS_SETTINGS, ...(row?.value as object) };
  }

  /** Matchs pronostiquables d'un tournoi + tendance du public (votes par côté). Public. */
  async predictionBoard(tournamentId: string) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    const st = this.toState(tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record) as Record<string, any>;
    const starts = (l.record.matchStarts as Record<string, number>) || {};
    const rows = await this.prisma.prediction.groupBy({ by: ['matchKey', 'pick'], where: { tournamentId }, _count: { _all: true } });
    const votes = (key: string, name: string) => rows.filter((r) => r.matchKey === key && r.pick === name).reduce((n, r) => n + r._count._all, 0);
    const open = l.t.status !== 'setup' ? this.predictableMatches(st) : [];
    const settings = await this.getPredictionSettings();
    return {
      open: l.t.status !== 'finished',
      matches: open.map((m) => ({ ...m, locked: !!starts[m.key], votesA: votes(m.key, m.a), votesB: votes(m.key, m.b) })),
      settings,
    };
  }

  /** Pronostics d'un membre sur ce tournoi, avec le verdict quand le match est joué. */
  async myPredictions(tournamentId: string, userId: string) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    const preds = await this.prisma.prediction.findMany({ where: { tournamentId, userId }, orderBy: { createdAt: 'asc' } });
    return preds.map((p) => {
      const w = this.winnerOf(l.t, p.matchKey);
      return { matchKey: p.matchKey, pick: p.pick, result: w === null ? 'pending' : w === p.pick ? 'won' : 'lost' };
    });
  }

  async predict(tournamentId: string, user: JwtUser, matchKey: string, pick: string) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    if (l.t.status === 'setup') throw new ConflictException('Les pronostics ouvrent quand le tournoi est lancé.');
    const st = this.toState(tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record) as Record<string, any>;
    const m = this.predictableMatches(st).find((x) => x.key === matchKey);
    if (!m) throw new ConflictException("Ce match n'accepte plus de pronostics.");
    if (pick !== m.a && pick !== m.b) throw new BadRequestException('Choix invalide pour ce match.');
    const starts = (l.record.matchStarts as Record<string, number>) || {};
    if (starts[matchKey]) throw new ConflictException('Ce match a commencé : les pronostics sont fermés.');
    // Pas de pronostic sur son propre match (l'équipe/le joueur inscrit avec ce compte).
    const own = await this.prisma.registration.findFirst({ where: { tournamentId, userId: user.sub, playerName: { in: [m.a, m.b] } } });
    if (own) throw new ForbiddenException('Tu ne peux pas pronostiquer ton propre match.');
    // Cote figée au moment du choix (% de votes déjà en place, hors le mien puisqu'il n'est pas encore
    // enregistré) : le bonus outsider à la résolution se base là-dessus, pas sur la cote du moment où le
    // match se termine — sans quoi un pronostic changerait rétroactivement de valeur.
    const voteRows = await this.prisma.prediction.groupBy({ by: ['pick'], where: { tournamentId, matchKey }, _count: { _all: true } });
    const countFor = (name: string) => voteRows.find((r) => r.pick === name)?._count._all ?? 0;
    const totalVotes = countFor(m.a) + countFor(m.b);
    const oddsPct = totalVotes ? Math.round((countFor(pick) / totalVotes) * 100) : 100;
    await this.prisma.prediction.upsert({
      where: { userId_tournamentId_matchKey: { userId: user.sub, tournamentId, matchKey } },
      update: { pick, oddsPct },
      create: { userId: user.sub, tournamentId, matchKey, pick, oddsPct },
    });
    return this.myPredictions(tournamentId, user.sub);
  }

  /** Agrège les pronostics de tout le monde, tous tournois confondus (bons, mauvais, en attente) — factorisé
   * pour être utilisé aussi bien par le classement public que par les stats persos d'un pronostiqueur. */
  private async aggregatePredictorsRaw(): Promise<{ userId: string; name: string; correct: number; total: number; pending: number; score: number }[]> {
    const preds = await this.prisma.prediction.findMany({ include: { user: { select: { displayName: true } } } });
    if (!preds.length) return [];
    const tournaments = await this.prisma.tournament.findMany({ where: { id: { in: [...new Set(preds.map((p) => p.tournamentId))] } }, select: { id: true, engineState: true } });
    const engines = new Map(tournaments.map((t) => [t.id, t.engineState as unknown as Engine.Tournament | null]));
    const { basePoints, outsiderThreshold, outsiderMultiplier } = await this.getPredictionSettings();
    const agg = new Map<string, { userId: string; name: string; correct: number; total: number; pending: number; score: number }>();
    for (const p of preds) {
      const e = agg.get(p.userId) ?? { userId: p.userId, name: p.user.displayName, correct: 0, total: 0, pending: 0, score: 0 };
      const t = engines.get(p.tournamentId);
      const w = t ? this.winnerOf(this.applyEngineCompat(t), p.matchKey) : null;
      if (w === null) e.pending++;
      // Bonus outsider : la cote figée au moment du pronostic (pas celle du jour où le match se termine).
      else { e.total++; if (w === p.pick) { e.correct++; e.score += p.oddsPct !== null && p.oddsPct < outsiderThreshold ? basePoints * outsiderMultiplier : basePoints; } }
      agg.set(p.userId, e);
    }
    return [...agg.values()];
  }

  /** Meilleurs pronostiqueurs (tous tournois) : bons pronostics d'abord, puis taux de réussite. Public. */
  async predictorsLeaderboard() {
    const all = await this.aggregatePredictorsRaw();
    return all
      .filter((e) => e.total > 0)
      .map((e) => ({ name: e.name, correct: e.correct, total: e.total, pending: e.pending, score: e.score, rate: Math.round((e.correct / e.total) * 100) }))
      .sort((a, b) => b.correct - a.correct || b.rate - a.rate)
      .slice(0, 30);
  }

  /** Mes stats de pronostiqueur (tous tournois) : bons pronostics, taux de réussite, rang parmi les
   * pronostiqueurs ayant au moins un pronostic tranché, et le score (10 pts par bon pronostic, 20 si le
   * choix était outsider au moment du pronostic). Rang nul tant qu'aucun de mes pronostics n'est tranché. */
  async myPredictorStats(userId: string) {
    const all = await this.aggregatePredictorsRaw();
    const ranked = all
      .filter((e) => e.total > 0)
      .map((e) => ({ ...e, rate: Math.round((e.correct / e.total) * 100) }))
      .sort((a, b) => b.correct - a.correct || b.rate - a.rate);
    const idx = ranked.findIndex((e) => e.userId === userId);
    const mine = idx >= 0 ? ranked[idx] : all.find((e) => e.userId === userId);
    const correct = mine?.correct ?? 0, total = mine?.total ?? 0;
    return { correct, total, pending: mine?.pending ?? 0, rate: total ? Math.round((correct / total) * 100) : 0, rank: idx >= 0 ? idx + 1 : null, score: mine?.score ?? 0 };
  }

  /** Duplique un tournoi comme « modèle » : mêmes réglages (format, barème, manches, frais, règlement, lot,
   * affiche, événement) mais sans joueurs ni résultats, en brouillon. Passe par create() : crédit
   * organisateur, plafonds et validation s'appliquent exactement comme pour un tournoi créé à la main. */
  async duplicate(id: string, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    const t = this.applyEngineCompat((r.engineState ?? Engine.newTournament({ name: r.name })) as unknown as Engine.Tournament);
    const dto: CreateTournamentDto = {
      name: `${r.name} (copie)`.slice(0, 120), game: r.game ?? undefined, format: r.format, place: r.place ?? undefined,
      nbPools: t.nbPools, pointsPerPlayer: t.pointsPerPlayer, imageUrl: r.imageUrl ?? undefined,
      entryFeeXof: r.entryFeeXof, givesLoyaltyPoint: r.givesLoyaltyPoint, eventId: r.eventId ?? undefined,
      survWin: t.scoring.survWin, loserWin: t.scoring.loserWin, poolFinalWin: t.scoring.poolFinalWin,
      finalsWin: t.scoring.finalsWin, championBonus: t.scoring.championBonus, streakBonus: t.scoring.streakBonus,
      streakLength: t.streakLength, finalsFormat: t.finalsFormat, poolFormat: t.poolFormat, qualifyPerPool: t.qualifyPerPool,
      matchMode: t.matchFormat.mode, matchValue: t.matchFormat.value, countGoalDiff: t.countGoalDiff, tiebreakers: Engine.effectiveTiebreakers(t),
      brPointsTable: t.brPointsTable, brKillPoints: t.brKillPoints,
      rules: r.rules ?? undefined, prize: r.prize ?? undefined, teamSize: r.teamSize ?? undefined,
      tier: (r.tier ?? undefined) as 'AMATEUR' | 'ELITE' | undefined,
      maxPlayers: r.maxPlayers ?? undefined,
    };
    return this.create(dto, user);
  }

  /** Démarre (ou arrête) le chronomètre d'un match lancé en régie. key = activeKey côté web. */
  async setMatchStart(tournamentId: string, key: string, on: boolean, user: JwtUser) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(l.record, user);
    const starts = { ...((l.record.matchStarts as Record<string, number>) || {}) };
    if (on) { if (!starts[key]) starts[key] = Date.now(); } else delete starts[key];
    await this.prisma.tournament.update({ where: { id: tournamentId }, data: { matchStarts: starts } });
    return this.toState(tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, { ...l.record, matchStarts: starts });
  }

  /** Durée prévue d'un match en minutes (0 ou vide = pas d'alerte). */
  async setMatchMinutes(tournamentId: string, minutes: number | undefined, user: JwtUser) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(l.record, user);
    const matchMinutes = minutes && minutes > 0 ? Math.min(Math.round(minutes), 240) : null;
    await this.prisma.tournament.update({ where: { id: tournamentId }, data: { matchMinutes } });
    return this.toState(tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, { ...l.record, matchMinutes });
  }

  /** Matchs jouables d'un état de tournoi (poules : match courant ; phase finale : tout match prêt à lancer). */
  private playableMatches(st: Record<string, any>): { key: string; a: string; b: string }[] {
    const out: { key: string; a: string; b: string }[] = [];
    (st.pools || []).forEach((p: any) => { if (p.current) out.push({ key: p.id, a: p.current.aName, b: p.current.bName }); });
    const walk = (n: any): void => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.matchId && n.playable && n.aName && n.bName) { out.push({ key: n.matchId, a: n.aName, b: n.bName }); return; }
      Object.values(n).forEach(walk);
    };
    walk(st.finals);
    return out;
  }

  /** « Mon prochain match » : pour chaque tournoi EN DIRECT où le membre est inscrit (payé), son match prêt
   * à jouer (adversaire, poste s'il est déjà attribué) et le nombre d'autres matchs qui attendent encore un poste. */
  async myNextMatches(userId: string) {
    const regs = await this.prisma.registration.findMany({
      where: { userId, paymentStatus: 'paid', tournament: { status: 'LIVE' } },
      select: { playerName: true, tournamentId: true },
    });
    const out: { tournamentId: string; tournamentName: string; playerName: string; opponent: string; station: string | null; waitingAhead: number }[] = [];
    for (const reg of regs) {
      const l = await this.loadEngine(reg.tournamentId);
      if (!l) continue;
      const st = this.toState(reg.tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record) as Record<string, any>;
      const stations = (l.record.stations as Record<string, string>) || {};
      const playable = this.playableMatches(st);
      const mine = playable.find((m) => m.a === reg.playerName || m.b === reg.playerName);
      if (!mine) continue;
      const waiting = playable.filter((m) => !stations[m.key]);
      const idx = waiting.findIndex((m) => m.key === mine.key);
      out.push({
        tournamentId: reg.tournamentId, tournamentName: st.name, playerName: reg.playerName,
        opponent: mine.a === reg.playerName ? mine.b : mine.a,
        station: stations[mine.key] || null,
        waitingAhead: stations[mine.key] ? 0 : Math.max(0, idx),
      });
    }
    return out;
  }

  /** Prévient par e-mail les joueurs d'un match que celui-ci démarre (avec leur poste s'il en a un).
   * Seuls les joueurs inscrits avec un compte (Registration, rapprochée par pseudo) sont joignables ;
   * les autres (saisis à la main par l'organisateur) sont listés dans `unreachable` pour être appelés à voix haute. */
  async notifyMatch(tournamentId: string, key: string, user: JwtUser) {
    const l = await this.loadEngine(tournamentId);
    if (!l) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(l.record, user);
    const st = this.toState(tournamentId, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record) as Record<string, any>;
    // Le match : une poule (clé = id de poule, match courant) ou un match de phase finale (clé = matchId).
    let pair: { a: string; b: string } | null = null;
    const pool = (st.pools || []).find((p: any) => p.id === key);
    if (pool?.current) pair = { a: pool.current.aName, b: pool.current.bName };
    else {
      const walk = (n: any): void => {
        if (pair || !n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.matchId === key && n.aName && n.bName) { pair = { a: n.aName, b: n.bName }; return; }
        Object.values(n).forEach(walk);
      };
      walk(st.finals);
    }
    if (!pair) throw new NotFoundException('Match introuvable ou pas encore prêt.');
    const p = pair as { a: string; b: string };
    const station = ((l.record.stations as Record<string, string>) || {})[key] || null;
    const regs = await this.prisma.registration.findMany({
      where: { tournamentId, playerName: { in: [p.a, p.b] } },
      include: { user: { select: { email: true, displayName: true } } },
    });
    const sent: string[] = [];
    for (const reg of regs) {
      const opponent = reg.playerName === p.a ? p.b : p.a;
      const ok = await this.mail.send(
        reg.user.email,
        `C'est à toi de jouer — ${st.name}`,
        this.mail.layout(
          "C'est à toi de jouer !",
          `<p>Bonjour ${escapeHtml(reg.user.displayName)},</p>
           <p>Ton match du tournoi <b>${escapeHtml(st.name)}</b> démarre : <b>${escapeHtml(reg.playerName)}</b> contre <b>${escapeHtml(opponent)}</b>.</p>
           ${station ? `<p>Rends-toi à : <b>${escapeHtml(station)}</b>.</p>` : ''}
           <p>Présente-toi vite auprès de l'organisateur.</p>`,
          { label: 'Voir le tournoi', url: `${this.mail.siteUrl}/tournois/${tournamentId}` },
        ),
      );
      if (ok) sent.push(reg.playerName);
    }
    const reachable = new Set(regs.map((r) => r.playerName));
    return { players: [p.a, p.b], sent, unreachable: [p.a, p.b].filter((n) => !sent.includes(n) && !reachable.has(n)), mailFailed: regs.length - sent.length };
  }

  /** Pointage de présence (organisateur/admin) : par QR code / code court, ou directement sur une inscription. */
  async checkIn(tournamentId: string, dto: { code?: string; registrationId?: string; present?: boolean }, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    const regs = await this.prisma.registration.findMany({ where: { tournamentId } });
    let reg = dto.registrationId ? regs.find((x) => x.id === dto.registrationId) : undefined;
    if (!reg && dto.code) {
      // Le QR contient une adresse (…#ci=<tournoi>.<inscription>) ; le billet imprimé donne le code court à 6 caractères.
      const raw = dto.code.trim();
      const tail = raw.includes('#ci=') ? raw.split('#ci=')[1] : raw;
      const [tid, rid] = tail.includes('.') ? tail.split('.') : [null, tail];
      if (tid && tid !== tournamentId) throw new BadRequestException("Ce billet est celui d'un autre tournoi.");
      const key = (rid || '').trim().toLowerCase();
      const hits = regs.filter((x) => x.id.toLowerCase() === key || (key.length >= 6 && x.id.toLowerCase().endsWith(key)));
      if (hits.length > 1) throw new BadRequestException('Code ambigu : saisis le code complet ou scanne le QR.');
      reg = hits[0];
    }
    if (!reg) throw new NotFoundException('Aucune inscription ne correspond à ce billet pour ce tournoi.');
    if (reg.paymentStatus !== 'paid') throw new ConflictException("L'inscription n'est pas payée : impossible de pointer ce joueur.");
    const present = dto.present !== false;
    const already = present && !!reg.checkedInAt;
    const upd = await this.prisma.registration.update({ where: { id: reg.id }, data: { checkedInAt: present ? (reg.checkedInAt ?? new Date()) : null } });
    const paid = regs.filter((x) => x.paymentStatus === 'paid');
    const checked = paid.filter((x) => (x.id === upd.id ? !!upd.checkedInAt : !!x.checkedInAt)).length;
    return { registrationId: upd.id, playerName: upd.playerName, checkedIn: !!upd.checkedInAt, already, count: checked, total: paid.length };
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

    const teams = { ...((r.teams as Record<string, string[]>) || {}) };
    delete teams[reg.playerName];
    await this.prisma.$transaction([
      this.prisma.registration.delete({ where: { id: reg.id } }),
      this.prisma.tournament.update({
        where: { id },
        data: { ...(t ? { engineState: JSON.parse(JSON.stringify(t)) } : {}), ...(r.teamSize ? { teams } : {}) },
      }),
    ]);
    // Rembourse les points dépensés sur cette inscription, et retire le point de participation
    // gagné s'il l'avait déjà été (désinscription possible tant que le tournoi n'a pas démarré).
    if (reg.pointsRedeemed > 0) {
      await this.loyalty.award(user.sub, reg.pointsRedeemed, LoyaltyReason.REFUND, { registrationId: reg.id, note: r.name });
    }
    if (reg.paymentStatus === 'paid' && r.givesLoyaltyPoint) {
      await this.loyalty.revokeUpTo(user.sub, 1, LoyaltyReason.REFUND, { registrationId: reg.id, note: r.name });
    }
    return { registered: false, players: t ? t.players.length : 0 };
  }

  /** Tournois où l'utilisateur est inscrit, avec le statut de paiement (pour l'affichage). */
  async registrationIds(user: JwtUser) {
    const regs = await this.prisma.registration.findMany({
      where: { userId: user.sub },
      select: { id: true, tournamentId: true, paymentStatus: true, paymentMethod: true, amountXof: true, checkedInAt: true },
    });
    return regs.map((x) => ({ id: x.tournamentId, regId: x.id, method: x.paymentMethod, status: x.paymentStatus, amountXof: x.amountXof, checkedIn: !!x.checkedInAt, code: this.ticketCode(x.id) }));
  }

  async remove(id: string, user: JwtUser) {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Tournoi introuvable');
    this.assertCanManage(r, user);
    await this.prisma.match.deleteMany({ where: { tournamentId: id } });
    await this.prisma.tournament.delete({ where: { id } });
    // Remboursement du crédit uniquement si le tournoi n'a jamais été lancé (sinon l'organisateur
    // a déjà tiré une vraie valeur du crédit dépensé) — pas de remboursement pour le tournoi gratuit.
    if (r.status === 'DRAFT' && r.createdById) await this.credits.refundHostingIfApplicable(r.createdById, id);
    return { deleted: true };
  }

  /** Insère des tournois de démonstration si la table est vide. */
  async seed() {
    const count = await this.prisma.tournament.count();
    if (count > 0) return { seeded: false, count };

    const demos: Array<CreateTournamentDto & { status: string; live?: boolean }> = [
      { name: 'Survival Cup · Lomé', game: 'EA FC 26', format: 'SURVIVAL', place: 'Lomé', date: '2026-07-12', pointsPerPlayer: 5, players: gen(32), status: 'LIVE' },
      { name: 'Tekken Kings Cup', game: 'Tekken 8', format: 'DOUBLE_ELIM', place: 'Lomé', date: '2026-07-19', pointsPerPlayer: 5, players: gen(24), status: 'DRAFT' },
      { name: 'Free Fire Togo Series', game: 'Free Fire', format: 'BATTLE_ROYALE', place: 'Kara', date: '2026-07-26', pointsPerPlayer: 5, nbPools: 6, players: gen(48), status: 'LIVE' },
      { name: 'Valorant Lomé Open', game: 'Valorant', format: 'ROUND_ROBIN', place: 'Lomé', date: '2026-08-02', pointsPerPlayer: 5, players: gen(16), status: 'DRAFT' },
      { name: 'eFootball Coupe Kara', game: 'eFootball', format: 'POOLS', place: 'Kara', date: '2026-06-28', pointsPerPlayer: 5, players: gen(24), status: 'FINISHED' },
      { name: 'Mortal Kombat Bash', game: 'MK1', format: 'SINGLE_ELIM', place: 'Sokodé', date: '2026-08-09', pointsPerPlayer: 5, players: gen(12), status: 'DRAFT' },
      { name: 'Street Fighter 6 Rumble', game: 'Street Fighter 6', format: 'SWISS', place: 'Lomé', date: '2026-08-16', pointsPerPlayer: 5, players: gen(20), status: 'DRAFT' },
    ];

    for (const d of demos) {
      const engineFormat = engineFormatFor(d.format);
      const t = Engine.newTournament({ name: d.name, game: d.game, place: d.place, nbPools: d.nbPools ?? 2, pointsPerPlayer: d.pointsPerPlayer ?? 5, format: engineFormat });
      Engine.setPlayers(t, d.players ?? []);
      // Rend l'état cohérent : les LIVE sont lancés & partiellement joués, les FINISHED joués jusqu'au champion.
      if (d.status === 'LIVE' || d.status === 'FINISHED') {
        const full = d.status === 'FINISHED';
        if (engineFormat === 'survival') {
          Engine.distributePools(t);
          t.pools.forEach((p) => (p.order = p.playerIds.slice()));
          Engine.launch(t);
          let guard = 0;
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
              for (const m of Engine.allFinalsMatches(t)) {
                if (m.a && m.b && m.a !== Engine.BYE && m.b !== Engine.BYE && !m.winner && !m.bye) { Engine.reportFinals(t, m.id, m.a); acted = true; }
              }
              if (!acted) break;
            }
          }
        } else {
          Engine.launchTournament(t);
          let guard = 0;
          while (t.status !== 'finished' && guard++ < (full ? 2000 : 3)) {
            let acted = false;
            if (engineFormat === 'swiss') {
              const f = t.finals as Engine.SwissFinals;
              const round = f.rounds[f.rounds.length - 1];
              for (const m of round) { if (m.a && m.b && !m.winner && !m.bye) { Engine.reportSwiss(t, m.id, m.a); acted = true; break; } }
            } else if (engineFormat === 'battle_royale') {
              const f = t.finals as Engine.BattleRoyaleFinals;
              const g = f.games.find((x) => !x.ranking);
              if (g) { Engine.reportBattleRoyale(t, g.id, t.players.map((p) => p.id)); acted = true; }
            } else {
              for (const m of Engine.allFinalsMatches(t)) {
                if (m.a && m.b && m.a !== Engine.BYE && m.b !== Engine.BYE && !m.winner && !m.bye) { Engine.reportFinals(t, m.id, m.a); acted = true; break; }
              }
            }
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

  private async loadEngine(id: string): Promise<{ record: { id: string; createdById: string | null; eventId: string | null; entryFeeXof: number; imageUrl: string | null; format: string; place: string | null; date: Date | null; givesLoyaltyPoint: boolean; stations: unknown; streamMatchKey: string | null; matchStarts: unknown; matchMinutes: number | null; rules: string | null; prize: string | null; teamSize: number | null; teams: unknown }; t: Engine.Tournament } | null> {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r || !r.engineState) return null;
    const t = this.applyEngineCompat(r.engineState as unknown as Engine.Tournament);
    // Nom, jeu et lieu sont modifiables depuis la base (PATCH /tournaments/:id) : la copie qu'en garde l'état moteur peut
    // être périmée (tournoi renommé ou dupliqué puis modifié). La base fait foi, à chaque lecture — sinon la fiche, le
    // formulaire de modification (pré-rempli depuis cette fiche) et les écrans de diffusion montrent l'ancien nom/jeu.
    this.syncMeta(t, r);
    return { record: r, t };
  }

  /** Aligne sur la base les métadonnées dupliquées dans l'état moteur (nom, jeu, lieu). */
  private syncMeta(t: Engine.Tournament, src: { name: string; game: string | null; place: string | null }): Engine.Tournament {
    t.name = src.name;
    t.game = src.game || '';
    t.place = src.place || '';
    return t;
  }

  /** Complète un état moteur persisté avant l'ajout de certains champs, pour qu'il soit exploitable
   * par la version actuelle du moteur. À appliquer AVANT tout appel au moteur : sans ça, un champ
   * absent se propage en NaN (ex. `nRealPools * scoring.streakBonus` dans cagnotte(), qui rendrait
   * le barème invalide puis le ferait rogner à NaN par autoFitScoring — corruption définitive). */
  private applyEngineCompat(t: Engine.Tournament): Engine.Tournament {
    // Compat : tournois créés avant l'ajout de la disqualification / des formats de finale / du format principal.
    if (!t.disqualified) t.disqualified = [];
    if (!t.finalsFormat) t.finalsFormat = 'single';
    if (t.finals && !(t.finals as { format?: string }).format) (t.finals as unknown as { format: string }).format = 'single';
    if (!t.format) t.format = 'survival';
    // Compat : tournois créés avant l'ajout du mode de poule (double élim) et du bonus striker.
    if (!t.poolFormat) t.poolFormat = 'survival';
    // Compat : tournois enregistrés avant que "survival" (le mode de poule, marque de fabrique du
    // format Survival) ne soit réservé à ce seul format — un Bracket simple/Double élim/Round Robin
    // hérité affichait encore "Survival classique" dans son réglage de poules. Restreint au brouillon
    // (avant lancement) : une fois les poules jouées sous le mécanisme survival (vainqueur qui reste
    // sur le terrain, wSurvivor/wIndex), changer l'étiquette a posteriori mélangerait le libellé des
    // matchs déjà joués avec un mode qu'ils n'ont jamais suivi.
    if (t.format !== 'survival' && t.poolFormat === 'survival' && t.status === 'setup') t.poolFormat = 'roundrobin';
    // Compat : un brouillon Bracket simple réglé sur des poules « double » (ancien choix indépendant) suit désormais le
    // format principal — chaque poule en mini-bracket à élimination directe. Les poules d'un tournoi déjà lancé ne changent pas.
    if (t.format === 'single' && t.poolFormat === 'double' && t.status === 'setup') t.poolFormat = 'single';
    if (t.scoring && t.scoring.streakBonus === undefined) t.scoring.streakBonus = 0;
    if (!t.streakLength) t.streakLength = Engine.DEFAULT_STREAK_LENGTH;
    // Compat : tournois créés avant l'ouverture des poules aux formats à phase finale.
    if (!t.qualifyPerPool) t.qualifyPerPool = Engine.DEFAULT_QUALIFY_PER_POOL;
    // Compat : tournois créés avant le format de manche (Bo/Ft) — Bo1 reproduit exactement le
    // comportement historique (un match = un score final, pas de majorité à atteindre).
    if (!t.matchFormat) t.matchFormat = Engine.DEFAULT_MATCH_FORMAT;
    // Compat : tournois créés avant l'option de départage par différence de buts — true reproduit
    // le comportement historique (toujours pris en compte).
    if (t.countGoalDiff === undefined) t.countGoalDiff = true;
    // Compat : tournois Battle Royale créés avant que le barème (palier de classement + bonus
    // élimination) ne soit réglable — reprend les valeurs jusqu'ici figées dans le moteur.
    if (!t.brPointsTable || !t.brPointsTable.length) t.brPointsTable = Engine.DEFAULT_BR_POINTS.slice();
    if (t.brKillPoints === undefined) t.brKillPoints = 1;
    if (t.finals && t.finals.format === 'battle_royale' && (t.finals as Engine.BattleRoyaleFinals).killPoints === undefined) {
      (t.finals as Engine.BattleRoyaleFinals).killPoints = 0; // ancien tournoi déjà lancé sans le bonus : rétrocompatible à 0, pas de recalcul rétroactif des parties déjà jouées.
    }
    t.pools?.forEach((p) => {
      if (!p.dbracket) p.dbracket = null;
      if (!p.sbracket) p.sbracket = null;
      if (!p.streaks) p.streaks = {};
      if (!p.streakAwarded) p.streakAwarded = {};
      if (!p.rrmatches) p.rrmatches = null;
      if (!p.qualified) p.qualified = [];
    });
    return t;
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
    // Round Robin est le seul mode de poule où le classement affiché doit être EXACTEMENT celui qui
    // décide de la qualification (Engine.poolRRRanking : victoires puis différence de buts/manches) —
    // sinon le tableau pouvait montrer un ordre différent de celui des badges "qualifiés" au-dessus.
    if (t.poolFormat === 'roundrobin') {
      // Pts = points de championnat (3 par victoire), pas les points de récompense du tournoi
      // (t.points) — même convention que le classement Round Robin de phase finale, voir plus bas.
      return Engine.poolRRRanking(t, pool).map((r) => ({ id: r.id, name: Engine.playerName(t, r.id), pts: r.wins * 3, wins: r.wins, played: r.played, losses: r.played - r.wins, gd: r.gd }));
    }
    const wins: Record<string, number> = {};
    t.log.filter((l) => l.poolId === pool.id).forEach((l) => { wins[l.winner] = (wins[l.winner] || 0) + 1; });
    return pool.playerIds.slice()
      .sort((a, b) => (t.points[b] || 0) - (t.points[a] || 0) || (wins[b] || 0) - (wins[a] || 0))
      .map((pid) => ({ id: pid, name: Engine.playerName(t, pid), pts: t.points[pid] || 0, wins: wins[pid] || 0 }));
  }

  private serializeMatch(t: Engine.Tournament, mm: Engine.BracketMatch) {
    const real = (id: string | null) => id && id !== Engine.BYE ? id : null;
    return {
      matchId: mm.id, bye: mm.bye,
      aName: real(mm.a) ? Engine.playerName(t, mm.a) : null, bName: real(mm.b) ? Engine.playerName(t, mm.b) : null,
      aId: real(mm.a), bId: real(mm.b), winnerId: real(mm.winner),
      sa: mm.sa ?? null, sb: mm.sb ?? null,
      playable: !!(real(mm.a) && real(mm.b) && !mm.winner && !mm.bye),
    };
  }

  /** Sérialise la phase finale — forme différente selon single/double/round robin. */
  private serializeFinals(t: Engine.Tournament) {
    const f = t.finals;
    if (!f) return null;
    const champion = t.champion ? Engine.playerName(t, t.champion) : null;
    // Phase finale en mode Survival : simple marqueur — la "grande poule" qui contient les données
    // réelles (joueurs, match en cours, classement) est déjà sérialisée séparément dans `pools`
    // (voir toState), rendue par le même composant que n'importe quelle poule.
    if (f.format === 'survival') return { format: 'survival' as const, champion };
    if (f.format === 'roundrobin') {
      // Pts du classement Round Robin = points de championnat (3 par victoire, convention standard
      // de nombreux sports — pas de match nul en 1v1 donc rien à ajouter pour ça) : une notion de
      // classement distincte des points de récompense du tournoi (t.points, barème/cagnotte), qui
      // restent calculés et distribués séparément.
      const standings = Engine.rrRanking(t).map((r) => ({ id: r.id, name: Engine.playerName(t, r.id), wins: r.wins, played: r.played, losses: r.played - r.wins, gd: r.gd, pts: r.wins * 3 }));
      return { format: 'roundrobin' as const, champion, matches: f.matches.map((mm) => this.serializeMatch(t, mm)), standings };
    }
    if (f.format === 'double') {
      return {
        format: 'double' as const, champion,
        wb: f.wb.map((round, r) => ({ label: 'Winners · ' + this.roundLabel(r, f.wb.length), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
        lb: f.lb.map((round, r) => ({ label: 'Perdants · Round ' + (r + 1), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
        gf: this.serializeMatch(t, f.gf),
        gf2: f.gf2 ? this.serializeMatch(t, f.gf2) : null,
      };
    }
    if (f.format === 'swiss') {
      const standings = Engine.swissStandings(t).map((r) => ({ id: r.id, name: Engine.playerName(t, r.id), wins: r.wins, buchholz: r.buchholz, pts: t.points[r.id] || 0 }));
      return {
        format: 'swiss' as const, champion, roundCount: f.roundCount,
        rounds: f.rounds.map((round, r) => ({ label: 'Ronde ' + (r + 1), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
        standings,
      };
    }
    if (f.format === 'battle_royale') {
      // Classement enrichi (éliminations cumulées, victoires "WWCD", détail place+points par partie)
      // pour le tableau de bord façon Battle Royale — pas seulement le total, qui à lui seul ne dit
      // pas d'où viennent les points (place vs éliminations) ni la régularité sur les parties jouées.
      const killPoints = f.killPoints || 0;
      const gamePts = (rank: number, kills: number) => (f.pointsTable[rank] ?? f.pointsTable[f.pointsTable.length - 1] ?? 0) + killPoints * kills;
      const totalKills: Record<string, number> = {}, wins: Record<string, number> = {};
      t.players.forEach((p) => { totalKills[p.id] = 0; wins[p.id] = 0; });
      f.games.forEach((g) => {
        if (!g.ranking) return;
        g.ranking.forEach((pid, rk) => {
          if (rk === 0) wins[pid] = (wins[pid] || 0) + 1;
          totalKills[pid] = (totalKills[pid] || 0) + (g.kills?.[pid] || 0);
        });
      });
      const standings = t.players.slice()
        .sort((a, b) => (t.points[b.id] || 0) - (t.points[a.id] || 0))
        .map((p) => ({
          id: p.id, name: p.name, pts: t.points[p.id] || 0, kills: totalKills[p.id] || 0, wins: wins[p.id] || 0,
          games: f.games.map((g) => {
            const rk = g.ranking ? g.ranking.indexOf(p.id) : -1;
            if (!g.ranking || rk < 0) return { played: false as const };
            const k = g.kills?.[p.id] || 0;
            return { played: true as const, rank: rk + 1, kills: k, pts: gamePts(rk, k) };
          }),
        }));
      return {
        format: 'battle_royale' as const, champion, pointsTable: f.pointsTable, killPoints,
        games: f.games.map((g, i) => ({
          id: g.id, label: 'Partie ' + (i + 1), played: !!g.ranking,
          ranking: g.ranking ? g.ranking.map((pid, rk) => ({ id: pid, name: Engine.playerName(t, pid), rank: rk + 1, kills: g.kills?.[pid] || 0, pts: gamePts(rk, g.kills?.[pid] || 0) })) : null,
        })),
        standings,
      };
    }
    const total = f.bracket.rounds.length;
    return {
      format: 'single' as const, champion,
      rounds: f.bracket.rounds.map((round, r) => ({ label: this.roundLabel(r, total), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
      // Petite finale (3e place) — n'existe que s'il y a eu une vraie demi-finale (voir Engine.buildBracket).
      thirdPlace: f.bracket.thirdPlace ? this.serializeMatch(t, f.bracket.thirdPlace) : null,
    };
  }

  /** DTO « cockpit » : match courant, classement par poule, bracket finale. */
  private toState(
    id: string, t: Engine.Tournament, entryFeeXof = 0, imageUrl: string | null = null,
    format: string | null = null, place: string | null = null, date: Date | null = null, givesLoyaltyPoint = true,
    stations: unknown = null, streamMatchKey: string | null = null,
    extra: { matchStarts?: unknown; matchMinutes?: number | null; rules?: string | null; prize?: string | null; teamSize?: number | null; teams?: unknown; tier?: string; maxPlayers?: number | null } = {},
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
        order: p.order.map((pid) => ({ id: pid, name: Engine.playerName(t, pid) })),
        ranking: this.poolRanking(t, p),
        qualified: Engine.poolQualified(t, p).map((pid) => ({ id: pid, name: Engine.playerName(t, pid) })),
        // Rencontres du mini round robin de la poule (poolFormat 'roundrobin') — même forme que les
        // matchs d'un Round Robin de phase finale, pour être rendues par le même composant. Un seul
        // match par poule est réellement rapportable à la fois (Engine.currentMatch/reportResult ne
        // résout que celui-là, dans l'ordre de rrmatches) : marquer TOUT match non joué "playable"
        // laisserait cliquer un autre match que le courant, et le résultat serait appliqué au mauvais.
        rrmatches: (p.rrmatches || []).map((mm) => ({
          matchId: mm.id, aId: mm.a, bId: mm.b,
          aName: mm.a ? Engine.playerName(t, mm.a) : null,
          bName: mm.b ? Engine.playerName(t, mm.b) : null,
          winnerId: mm.winner, sa: mm.sa ?? null, sb: mm.sb ?? null,
          playable: !!(m && m.matchId === mm.id && !mm.winner && !mm.bye),
        })),
        // Mini-bracket double élimination de la poule (poolFormat 'double') — même forme que la
        // phase finale en double élim, pour être rendu par le même composant (doubleElimTree) : sans
        // ça, l'organisateur ne voit que le match du moment, sans jamais voir la progression du groupe.
        // Colonnes nommées « Manche N » : Quarts / Demi-finales / Finale sont réservés aux brackets de la
        // phase finale (voir plus haut), pas aux mini-brackets de poule.
        dbracket: p.dbracket ? {
          wb: p.dbracket.wb.map((round, r) => ({ label: 'Manche ' + (r + 1), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
          lb: p.dbracket.lb.map((round, r) => ({ label: 'Manche ' + (r + 1), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
          gf: this.serializeMatch(t, p.dbracket.gf),
          gf2: p.dbracket.gf2 ? this.serializeMatch(t, p.dbracket.gf2) : null,
        } : null,
        // Mini-bracket à élimination directe de la poule (poolFormat 'single') — mêmes rondes que le Bracket
        // simple de phase finale (rendu par bracketTree), colonnes « Manche N ».
        sbracket: p.sbracket ? {
          rounds: p.sbracket.rounds.map((round, r) => ({ label: 'Manche ' + (r + 1), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
        } : null,
      };
    });
    return {
      id, name: t.name, game: t.game || '', status: t.status,
      mainFormat: t.format, // format réellement piloté par le moteur ('survival' | 'single' | 'double' | 'roundrobin' | 'swiss' | 'battle_royale') — distinct de `format` (étiquette d'affichage)
      champion: t.champion ? Engine.playerName(t, t.champion) : null,
      cagnotte: Engine.cagnotte(t), distributed: Engine.distributed(t),
      allPoolsDone: Engine.allPoolsDone(t),
      players: t.players.map((p) => ({ id: p.id, name: p.name, club: p.club, disqualified: t.disqualified.includes(p.id) })),
      // Classement global (id/nom/points/V/D), format-agnostique — utile hors survival où il n'y a pas de poules pour dériver un classement.
      standings: Engine.overallRanking(t),
      nbPools: t.nbPools,
      pointsPerPlayer: t.pointsPerPlayer,
      scoring: t.scoring,
      finalsFormat: t.finalsFormat,
      poolFormat: t.poolFormat,
      qualifyPerPool: t.qualifyPerPool,
      usesPools: Engine.usesPools(t),
      matchFormat: t.matchFormat,
      matchFormatLabel: Engine.matchFormatLabel(t.matchFormat),
      countGoalDiff: t.countGoalDiff,
      tiebreakers: Engine.effectiveTiebreakers(t),
      // Battle Royale : barème pré-lancement (préremplissage de l'assistant en édition) — une fois
      // lancé, la valeur qui compte réellement est celle figée dans finals.pointsTable/killPoints
      // (voir serializeFinals), ces deux-là ne représentent alors plus que le réglage figé au départ.
      brPointsTable: t.brPointsTable,
      brKillPoints: t.brKillPoints,
      streakLength: t.streakLength,
      canUndo: !!(t._undo && t._undo.length),
      entryFeeXof,
      givesLoyaltyPoint,
      imageUrl,
      // Poste/table assigné à chaque match en cours (LAN à plusieurs postes) — voir setStation.
      stations: (stations as Record<string, string>) || {},
      // Match actuellement à l'antenne (un seul à la fois) — voir setStreamMatch.
      streamMatchKey,
      // Chronomètre par match : heure de début (ms) par activeKey, et durée prévue (minutes) — voir setMatchStart.
      matchStarts: (extra.matchStarts as Record<string, number>) || {},
      matchMinutes: extra.matchMinutes ?? null,
      // Règlement et lot (texte libre saisi par l'organisateur).
      rules: extra.rules ?? null,
      prize: extra.prize ?? null,
      // Tournoi par équipes : taille des équipes et composition { nomÉquipe: [joueurs] } (null = individuel).
      teamSize: extra.teamSize ?? null,
      maxPlayers: extra.maxPlayers ?? null,
      teams: (extra.teams as Record<string, string[]>) || {},
      tier: extra.tier === 'ELITE' || extra.tier === 'AMATEUR' ? extra.tier : null,
      format: format ? (FORMAT_LABEL[format] || format) : null,
      place,
      date: date ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null,
      pools, finals: this.serializeFinals(t),
      // Historique des vrais duels déjà joués (bonus/ajustements exclus, voir Engine.correctResult) —
      // utilisé pour la correction d'un match précis (crayon) : la poule Survival classique n'a pas
      // d'autre trace consultable de ses matchs passés (Engine.currentMatch ne garde que le courant).
      log: t.log.filter((l) => l.a && l.b).map((l) => ({
        id: l.id, poolId: l.poolId, matchId: l.matchId ?? null,
        aId: l.a, aName: Engine.playerName(t, l.a), bId: l.b, bName: Engine.playerName(t, l.b),
        winnerId: l.winner, sa: l.sa ?? null, sb: l.sb ?? null, ts: l.ts,
      })),
    };
  }

  private roundLabel(r: number, total: number) {
    const fe = total - r;
    return fe === 1 ? 'Finale' : fe === 2 ? 'Demi-finales' : fe === 3 ? 'Quarts' : '1/' + Math.pow(2, fe - 1);
  }

  async getState(id: string) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    const state = this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
    // Événement auquel le tournoi appartient (seulement s'il est publié) : le Mode Show l'annonce et
    // reprend sa couverture en arrière-plan. La liste des autres tournois de l'événement permet de
    // basculer de l'un à l'autre directement depuis la fiche, sans repasser par la page de l'événement.
    let event: { id: string; name: string; tagline: string | null; posterUrl: string | null; bannerUrl: string | null; accentColor: string | null; tournaments: { id: string; name: string; live: boolean; status: string }[] } | null = null;
    if (l.record.eventId) {
      const ev = await this.prisma.event.findUnique({
        where: { id: l.record.eventId },
        select: { id: true, name: true, tagline: true, posterUrl: true, bannerUrl: true, accentColor: true, status: true },
      });
      if (ev && ev.status === 'PUBLISHED') {
        const siblings = await this.prisma.tournament.findMany({
          where: { eventId: ev.id },
          select: { id: true, name: true, status: true },
          orderBy: { createdAt: 'asc' },
        });
        event = {
          id: ev.id, name: ev.name, tagline: ev.tagline, posterUrl: ev.posterUrl, bannerUrl: ev.bannerUrl, accentColor: ev.accentColor,
          tournaments: siblings.map((s) => ({ id: s.id, name: s.name, live: s.status === 'LIVE', status: s.status === 'FINISHED' ? 'Terminé' : s.status === 'LIVE' ? '' : 'À venir' })),
        };
      }
    }
    // eventId brut, toujours présent même si l'événement est en brouillon (donc absent de `event`
    // ci-dessus) — sert côté web à savoir où revenir depuis le bouton « retour » de la fiche tournoi.
    return { ...state, event, eventId: l.record.eventId ?? null };
  }

  async launch(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const { t } = l;
    if (!t.players.length) throw new BadRequestException('Ajoute des joueurs avant de lancer le tournoi.');
    if (t.format === 'survival') {
      if (!t.pools.length) { Engine.distributePools(t); t.pools.forEach((p) => (p.order = p.playerIds.slice())); }
      Engine.launch(t);
    } else {
      Engine.launchTournament(t); // single/double/roundrobin/swiss/battle_royale : pas de poules, structure de compétition directement à partir de tous les joueurs
    }
    await this.persist(id, t);
    return this.toState(id, t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  async startFinals(id: string, user: JwtUser, format?: Engine.FinalsFormat) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    Engine.startFinals(l.t, format);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  async report(id: string, dto: ReportDto, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const { t } = l;
    const sa = dto.scoreA ?? 0, sb = dto.scoreB ?? 0;
    if (dto.matchId) {
      if (t.finals?.format === 'swiss') Engine.reportSwiss(t, dto.matchId, dto.winnerId ?? '', sa, sb);
      else Engine.reportFinals(t, dto.matchId, dto.winnerId ?? '', sa, sb);
    }
    else if (dto.poolId) Engine.reportResult(t, dto.poolId, dto.winnerId ?? '', sa, sb);
    await this.persist(id, t);
    // Le match est joué : son chronomètre s'arrête (une clé de poule sert à des matchs successifs).
    let record = l.record;
    const key = dto.matchId || dto.poolId;
    const starts = { ...((l.record.matchStarts as Record<string, number>) || {}) };
    if (key && starts[key]) {
      delete starts[key];
      await this.prisma.tournament.update({ where: { id }, data: { matchStarts: starts } });
      record = { ...l.record, matchStarts: starts };
    }
    return this.toState(id, t, record.entryFeeXof, record.imageUrl, record.format, record.place, record.date, record.givesLoyaltyPoint, record.stations, record.streamMatchKey, record);
  }

  /** Corrige un match déjà joué (score/vainqueur saisi par erreur) — voir Engine.correctResult :
   * remet le tournoi dans l'état d'avant CE match précis puis y réapplique le résultat corrigé, en
   * cascade (tout ce qui s'est joué après est remis à rejouer). Repose sur la pile d'annulation
   * (25 actions) : au-delà, la correction n'est plus possible. */
  async correctResult(id: string, dto: CorrectResultDto, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const corrected = Engine.correctResult(l.t, dto.logId, dto.winnerId, dto.scoreA ?? 0, dto.scoreB ?? 0);
    if (!corrected) throw new ConflictException('Correction impossible : match introuvable, vainqueur invalide, ou trop ancien pour être corrigé.');
    await this.persist(id, corrected);
    return this.toState(id, corrected, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Rapporte le classement complet d'une partie Battle Royale (du 1er au dernier), et optionnellement le nombre d'éliminations par joueur. */
  async reportBattleRoyale(id: string, gameId: string, ranking: string[], user: JwtUser, kills?: Record<string, number>) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const { t } = l;
    if (t.finals?.format !== 'battle_royale') throw new ConflictException('Ce tournoi n\'est pas au format Battle Royale.');
    const res = Engine.reportBattleRoyale(t, gameId, ranking, kills);
    if (!res.ok) throw new BadRequestException('Partie introuvable, déjà rapportée, ou classement invalide.');
    await this.persist(id, t);
    return this.toState(id, t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Composition d'une équipe : exactement `size` joueurs, noms non vides et distincts. */
  private validTeam(members: string[] | undefined, size: number): string[] {
    const list = (members || []).map((m) => m.trim()).filter(Boolean);
    if (list.length !== size) throw new BadRequestException(`Une équipe compte exactement ${size} joueurs.`);
    if (new Set(list.map((m) => m.toLowerCase())).size !== list.length) throw new BadRequestException("Deux joueurs de l'équipe portent le même nom.");
    return list;
  }

  /** Remplace les joueurs d'une équipe — avant le lancement seulement (règle du tournoi par équipes). */
  async setTeamMembers(id: string, playerId: string, members: string[], user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (!l.record.teamSize) throw new BadRequestException("Ce n'est pas un tournoi par équipes.");
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a démarré : la composition des équipes est figée.');
    const player = l.t.players.find((p) => p.id === playerId);
    if (!player) throw new NotFoundException('Équipe introuvable.');
    const teams = { ...((l.record.teams as Record<string, string[]>) || {}), [player.name]: this.validTeam(members, l.record.teamSize) };
    await this.prisma.tournament.update({ where: { id }, data: { teams } });
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, { ...l.record, teams });
  }

  /** Ajout manuel d'un joueur par l'organisateur/admin — uniquement avant le lancement. */
  async addPlayer(id: string, name: string, user: JwtUser, members?: string[]) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a démarré : impossible d\'ajouter un joueur.');
    if (l.record.createdById) {
      const owner = await this.prisma.user.findUnique({ where: { id: l.record.createdById }, select: { organizerMaxPlayers: true } });
      if (owner?.organizerMaxPlayers != null && l.t.players.length >= owner.organizerMaxPlayers) {
        throw new ConflictException(`Ce tournoi a atteint le nombre maximum de participants autorisé pour ce compte (${owner.organizerMaxPlayers}).`);
      }
    }
    const team = l.record.teamSize ? this.validTeam(members, l.record.teamSize) : null;
    const p = Engine.addPlayer(l.t, name);
    if (!p) throw new BadRequestException('Nom invalide ou déjà utilisé dans ce tournoi.');
    await this.persist(id, l.t);
    const teams = { ...((l.record.teams as Record<string, string[]>) || {}) };
    if (team) { teams[p.name] = team; await this.prisma.tournament.update({ where: { id }, data: { teams } }); }
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, { ...l.record, teams });
  }

  /** Retrait d'un joueur par l'organisateur/admin — uniquement avant le lancement. */
  async removePlayer(id: string, playerId: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a démarré : impossible de retirer un joueur.');
    const removed = l.t.players.find((p) => p.id === playerId);
    if (!Engine.removePlayer(l.t, playerId)) throw new NotFoundException('Joueur introuvable.');
    await this.persist(id, l.t);
    const teams = { ...((l.record.teams as Record<string, string[]>) || {}) };
    if (removed && teams[removed.name]) { delete teams[removed.name]; await this.prisma.tournament.update({ where: { id }, data: { teams } }); }
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, { ...l.record, teams });
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Annule la dernière action mutante (résultat, ajustement, changement de barème, reset…). */
  async undo(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const restored = Engine.undo(l.t);
    if (!restored) throw new ConflictException('Rien à annuler.');
    await this.persist(id, restored);
    return this.toState(id, restored, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Remet un tournoi lancé par erreur à l'état "à lancer" (garde joueurs, poules-config, barème). */
  async reset(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status === 'setup') throw new ConflictException('Ce tournoi n\'a pas encore été lancé.');
    Engine.resetTournament(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Renomme un joueur (coquille repérée après coup) — à tout moment. */
  async renamePlayer(id: string, playerId: string, name: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const oldName = l.t.players.find((p) => p.id === playerId)?.name;
    const res = Engine.renamePlayer(l.t, playerId, name);
    if (!res.ok) {
      if (res.reason === 'duplicate') throw new ConflictException('Un autre participant porte déjà ce nom dans ce tournoi.');
      if (res.reason === 'not-found') throw new NotFoundException('Joueur introuvable.');
      throw new BadRequestException('Le nom ne peut pas être vide.');
    }
    await this.persist(id, l.t);
    const teams = { ...((l.record.teams as Record<string, string[]>) || {}) };
    const newName = l.t.players.find((p) => p.id === playerId)?.name;
    if (oldName && newName && oldName !== newName && teams[oldName]) { teams[newName] = teams[oldName]; delete teams[oldName]; await this.prisma.tournament.update({ where: { id }, data: { teams } }); }
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, { ...l.record, teams });
  }

  /** Modifie le club affiché d'un joueur — à tout moment. */
  async setPlayerClub(id: string, playerId: string, club: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (!Engine.setPlayerClub(l.t, playerId, club)) throw new NotFoundException('Joueur introuvable.');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Bonus/pénalité manuel avec motif, tracé dans le journal. */
  async manualAdjust(id: string, playerId: string, delta: number, reason: string | undefined, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (!Engine.manualAdjust(l.t, playerId, delta, reason)) throw new BadRequestException('Ajustement invalide (montant nul ou joueur introuvable).');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Modifie une valeur du barème (à tout moment) — resynchronise automatiquement les points déjà distribués,
   * puis réajuste proportionnellement le barème si la modification fait dépasser la cagnotte programmée. */
  async setScoring(id: string, key: string, value: number, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (!Engine.setScoring(l.t, key as keyof Engine.Scoring, value)) throw new BadRequestException('Clé de barème invalide.');
    if (l.t.format === 'survival' && !Engine.cagnotte(l.t).valid) Engine.autoFitScoring(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Répartit les joueurs en poules avant le lancement, pour prévisualiser/réordonner l'ordre de passage. */
  async distributePools(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    if (!l.t.players.length) throw new BadRequestException('Ajoute des joueurs avant de répartir les poules.');
    Engine.distributePools(l.t);
    l.t.pools.forEach((p) => (p.order = p.playerIds.slice()));
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Rebrasse l'ordre de passage d'une poule (avant lancement). */
  async shufflePoolOrder(id: string, poolId: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    const pool = l.t.pools.find((p) => p.id === poolId);
    if (!pool) throw new NotFoundException('Poule introuvable.');
    Engine.shuffleOrder(pool);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Déplace un joueur dans l'ordre de passage d'une poule (avant lancement). */
  async movePoolOrder(id: string, poolId: string, index: number, dir: number, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    const pool = l.t.pools.find((p) => p.id === poolId);
    if (!pool) throw new NotFoundException('Poule introuvable.');
    Engine.moveInOrder(pool, index, dir);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Change le nombre de qualifiés par poule (avant lancement) — endpoint dédié (même principe que
   * /scoring) pour rester ajustable directement depuis le panneau "Répartition des poules" une fois
   * les tailles réelles connues, sans repasser par l'assistant complet. */
  async setQualifyPerPool(id: string, value: number, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    l.t.qualifyPerPool = Engine.clampQualifyPerPool(value);
    if (l.t.format === 'survival' && !Engine.cagnotte(l.t).valid) Engine.autoFitScoring(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Déplace un joueur vers la poule adjacente (avant lancement) — rééquilibre manuellement l'effectif
   * des poules après la répartition automatique équilibrée (voir Engine.movePlayerToPool). */
  async movePoolPlayer(id: string, poolId: string, playerId: string, dir: number, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    const pool = l.t.pools.find((p) => p.id === poolId);
    if (!pool) throw new NotFoundException('Poule introuvable.');
    if (!Engine.movePlayerToPool(l.t, playerId, poolId, dir)) throw new BadRequestException('Déplacement impossible (poule de destination inexistante, ou poule d’origine réduite à un seul joueur).');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Déplace un joueur dans l'ordre du roster (formats sans poules : single/double/roundrobin/swiss) —
   * avant lancement, cet ordre détermine directement les oppositions du 1er tour (voir Engine.movePlayerOrder). */
  async moveRosterOrder(id: string, playerId: string, dir: number, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    if (!Engine.movePlayerOrder(l.t, playerId, dir === -1 ? -1 : 1)) throw new BadRequestException('Déplacement impossible.');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }

  /** Rebrasse aléatoirement l'ordre du roster (formats sans poules, avant lancement). */
  async shuffleRosterOrder(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    Engine.shufflePlayerOrder(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint, l.record.stations, l.record.streamMatchKey, l.record);
  }
}

function gen(n: number): string[] {
  return Array.from({ length: n }, (_, i) => 'Joueur ' + (i + 1));
}
