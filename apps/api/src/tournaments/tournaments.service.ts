import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Engine from '@vlome/engine';
import { CreateTournamentDto, RegisterDto, ReportDto, UpdateTournamentDto } from './tournaments.dto';
import { JwtUser } from '../common/jwt-auth.guard';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { CreditsService } from '../credits/credits.service';
import { LoyaltyReason } from '../../generated/prisma';
import { MailService, escapeHtml } from '../mail/mail.service';

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
    imageUrl?: string | null; entryFeeXof?: number; givesLoyaltyPoint?: boolean;
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
      place: r.place || '',
      players,
      cagnotte: isSurvival ? players * r.pointsPerPlayer : null,
      imageUrl: r.imageUrl || null,
      entryFeeXof: r.entryFeeXof ?? 0,
      givesLoyaltyPoint: r.givesLoyaltyPoint ?? true,
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
      countGoalDiff: dto.countGoalDiff,
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
    if (t.format === 'survival' && !Engine.cagnotte(t).valid) {
      throw new ConflictException('Le barème de points dépasse la cagnotte disponible (participants × points/joueur) pour ce mode de phase finale.');
    }
    const r = await this.prisma.tournament.create({
      data: {
        name: dto.name, game: dto.game ?? null, format: (dto.format ?? 'SURVIVAL') as any,
        status: 'DRAFT', place: dto.place ?? null, date: dto.date ? new Date(dto.date) : null,
        pointsPerPlayer: dto.pointsPerPlayer ?? 5, nbPools: dto.nbPools ?? 2,
        imageUrl: dto.imageUrl || null, entryFeeXof: dto.entryFeeXof ?? 0,
        givesLoyaltyPoint: dto.givesLoyaltyPoint ?? true,
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
    if (dto.entryFeeXof !== undefined) data.entryFeeXof = dto.entryFeeXof;
    if (dto.givesLoyaltyPoint !== undefined) data.givesLoyaltyPoint = dto.givesLoyaltyPoint;

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
        countGoalDiff: dto.countGoalDiff ?? prev?.countGoalDiff,
        ...(hasScoring ? {
          scoring: {
            survWin: dto.survWin ?? 1, loserWin: dto.loserWin ?? 0.5, poolFinalWin: dto.poolFinalWin ?? 1.5,
            finalsWin: dto.finalsWin ?? 2, championBonus: dto.championBonus ?? 3, streakBonus: dto.streakBonus ?? 0,
          },
        } : {}),
      });
      Engine.setPlayers(nt, (prev?.players || []).map((p) => (p.club ? `${p.name} @${p.club}` : p.name)));
      if (nt.format === 'survival' && !Engine.cagnotte(nt).valid) Engine.autoFitScoring(nt);
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
    if (dto.nbPools !== undefined || dto.pointsPerPlayer !== undefined || dto.finalsFormat !== undefined || dto.poolFormat !== undefined || dto.streakLength !== undefined || dto.qualifyPerPool !== undefined || dto.matchMode !== undefined || dto.countGoalDiff !== undefined) {
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
      if (dto.countGoalDiff !== undefined) t.countGoalDiff = dto.countGoalDiff;
      // Changer les poules/le mode change le nombre de matchs programmés : réajuste le barème si besoin.
      if (t.format === 'survival' && !Engine.cagnotte(t).valid) Engine.autoFitScoring(t);
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

    // Ville/club best-effort : depuis le profil de l'utilisateur inscrit sous ce nom (si connu),
    // et depuis la base de joueurs (roster) pour le club — rapprochement par nom, insensible à la casse.
    const regs = await this.prisma.registration.findMany({ include: { user: { select: { city: true } } } });
    const cityByName = new Map<string, string>();
    for (const r of regs) if (r.user.city && !cityByName.has(r.playerName)) cityByName.set(r.playerName, r.user.city);

    const rosterPlayers = await this.prisma.player.findMany({ include: { club: { select: { name: true } } } });
    const clubByName = new Map<string, string>();
    for (const p of rosterPlayers) if (p.club && !clubByName.has(p.name.toLowerCase())) clubByName.set(p.name.toLowerCase(), p.club.name);

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
        club: clubByName.get(e.name.toLowerCase()) || null,
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
    const allRegs = await this.prisma.registration.findMany({ where: { tournamentId: id }, select: { playerName: true } });
    const taken = new Set([...t.players.map((p) => p.name.toLowerCase()), ...allRegs.map((x) => x.playerName.toLowerCase())]);
    let playerName = u.displayName.trim() || u.email.split('@')[0];
    if (taken.has(playerName.toLowerCase())) {
      let n = 2;
      while (taken.has(`${playerName} (${n})`.toLowerCase())) n++;
      playerName = `${playerName} (${n})`;
    }

    if (netFee === 0) {
      // Gratuit (ou entièrement couvert par des points) : ajouté tout de suite.
      t.players.push({ id: Engine.uid(), name: playerName, club: u.city || '' });
      const reg = await this.prisma.$transaction(async (tx) => {
        const created = await tx.registration.create({
          data: {
            userId: user.sub, tournamentId: id, playerName, amountXof: 0, paymentStatus: 'paid',
            paymentMethod: pointsUsed > 0 ? 'Points fidélité' : null, pointsRedeemed: pointsUsed,
          },
        });
        await tx.tournament.update({ where: { id }, data: { engineState: JSON.parse(JSON.stringify(t)) } });
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
    if (pointsUsed > 0) {
      try {
        await this.loyalty.redeem(user.sub, pointsUsed, LoyaltyReason.REGISTRATION_REDEMPTION, { registrationId: reg.id, note: r.name });
      } catch (e) {
        await this.prisma.registration.delete({ where: { id: reg.id } });
        throw e;
      }
    }
    await this.notifyRegistration(user.sub, r.name, playerName, netFee, true, r.date, r.place);
    return { registered: true, pending: true, playerName, amountXof: netFee, pointsRedeemed: pointsUsed };
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

  private async loadEngine(id: string): Promise<{ record: { id: string; createdById: string | null; entryFeeXof: number; imageUrl: string | null; format: string; place: string | null; date: Date | null; givesLoyaltyPoint: boolean }; t: Engine.Tournament } | null> {
    const r = await this.prisma.tournament.findUnique({ where: { id } });
    if (!r || !r.engineState) return null;
    return { record: r, t: this.applyEngineCompat(r.engineState as unknown as Engine.Tournament) };
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
    t.pools?.forEach((p) => {
      if (!p.dbracket) p.dbracket = null;
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
      const standings = t.players.slice()
        .sort((a, b) => (t.points[b.id] || 0) - (t.points[a.id] || 0))
        .map((p) => ({ id: p.id, name: p.name, pts: t.points[p.id] || 0 }));
      return {
        format: 'battle_royale' as const, champion, pointsTable: f.pointsTable,
        games: f.games.map((g, i) => ({
          id: g.id, label: 'Partie ' + (i + 1), played: !!g.ranking,
          ranking: g.ranking ? g.ranking.map((pid, rk) => ({ id: pid, name: Engine.playerName(t, pid), rank: rk + 1, pts: f.pointsTable[rk] ?? f.pointsTable[f.pointsTable.length - 1] ?? 0 })) : null,
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
        qualified: (p.qualified || []).map((pid) => ({ id: pid, name: Engine.playerName(t, pid) })),
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
        dbracket: p.dbracket ? {
          wb: p.dbracket.wb.map((round, r) => ({ label: 'Winners · ' + this.roundLabel(r, p.dbracket!.wb.length), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
          lb: p.dbracket.lb.map((round, r) => ({ label: 'Perdants · Round ' + (r + 1), matches: round.map((mm) => this.serializeMatch(t, mm)) })),
          gf: this.serializeMatch(t, p.dbracket.gf),
          gf2: p.dbracket.gf2 ? this.serializeMatch(t, p.dbracket.gf2) : null,
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
      streakLength: t.streakLength,
      canUndo: !!(t._undo && t._undo.length),
      entryFeeXof,
      givesLoyaltyPoint,
      imageUrl,
      format: format ? (FORMAT_LABEL[format] || format) : null,
      place,
      date: date ? new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null,
      pools, finals: this.serializeFinals(t),
    };
  }

  private roundLabel(r: number, total: number) {
    const fe = total - r;
    return fe === 1 ? 'Finale' : fe === 2 ? 'Demi-finales' : fe === 3 ? 'Quarts' : '1/' + Math.pow(2, fe - 1);
  }

  async getState(id: string) {
    const l = await this.loadEngine(id);
    return l ? this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint) : null;
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
    return this.toState(id, t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  async startFinals(id: string, user: JwtUser, format?: Engine.FinalsFormat) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    Engine.startFinals(l.t, format);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Rapporte le classement complet d'une partie Battle Royale (du 1er au dernier). */
  async reportBattleRoyale(id: string, gameId: string, ranking: string[], user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const { t } = l;
    if (t.finals?.format !== 'battle_royale') throw new ConflictException('Ce tournoi n\'est pas au format Battle Royale.');
    const res = Engine.reportBattleRoyale(t, gameId, ranking);
    if (!res.ok) throw new BadRequestException('Partie introuvable, déjà rapportée, ou classement invalide.');
    await this.persist(id, t);
    return this.toState(id, t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Ajout manuel d'un joueur par l'organisateur/admin — uniquement avant le lancement. */
  async addPlayer(id: string, name: string, user: JwtUser) {
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
    const p = Engine.addPlayer(l.t, name);
    if (!p) throw new BadRequestException('Nom invalide ou déjà utilisé dans ce tournoi.');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Retrait d'un joueur par l'organisateur/admin — uniquement avant le lancement. */
  async removePlayer(id: string, playerId: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a démarré : impossible de retirer un joueur.');
    if (!Engine.removePlayer(l.t, playerId)) throw new NotFoundException('Joueur introuvable.');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Annule la dernière action mutante (résultat, ajustement, changement de barème, reset…). */
  async undo(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const restored = Engine.undo(l.t);
    if (!restored) throw new ConflictException('Rien à annuler.');
    await this.persist(id, restored);
    return this.toState(id, restored, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Remet un tournoi lancé par erreur à l'état "à lancer" (garde joueurs, poules-config, barème). */
  async reset(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status === 'setup') throw new ConflictException('Ce tournoi n\'a pas encore été lancé.');
    Engine.resetTournament(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Renomme un joueur (coquille repérée après coup) — à tout moment. */
  async renamePlayer(id: string, playerId: string, name: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    const res = Engine.renamePlayer(l.t, playerId, name);
    if (!res.ok) {
      if (res.reason === 'duplicate') throw new ConflictException('Un autre participant porte déjà ce nom dans ce tournoi.');
      if (res.reason === 'not-found') throw new NotFoundException('Joueur introuvable.');
      throw new BadRequestException('Le nom ne peut pas être vide.');
    }
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Modifie le club affiché d'un joueur — à tout moment. */
  async setPlayerClub(id: string, playerId: string, club: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (!Engine.setPlayerClub(l.t, playerId, club)) throw new NotFoundException('Joueur introuvable.');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Bonus/pénalité manuel avec motif, tracé dans le journal. */
  async manualAdjust(id: string, playerId: string, delta: number, reason: string | undefined, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (!Engine.manualAdjust(l.t, playerId, delta, reason)) throw new BadRequestException('Ajustement invalide (montant nul ou joueur introuvable).');
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
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
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }

  /** Rebrasse aléatoirement l'ordre du roster (formats sans poules, avant lancement). */
  async shuffleRosterOrder(id: string, user: JwtUser) {
    const l = await this.loadEngine(id);
    if (!l) return null;
    this.assertCanManage(l.record, user);
    if (l.t.status !== 'setup') throw new ConflictException('Le tournoi a déjà démarré.');
    Engine.shufflePlayerOrder(l.t);
    await this.persist(id, l.t);
    return this.toState(id, l.t, l.record.entryFeeXof, l.record.imageUrl, l.record.format, l.record.place, l.record.date, l.record.givesLoyaltyPoint);
  }
}

function gen(n: number): string[] {
  return Array.from({ length: n }, (_, i) => 'Joueur ' + (i + 1));
}
