import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import type { JwtUser } from '../common/jwt-auth.guard';
import type { EventDto, EventUpdateDto, ScheduleItemDto, ScheduleItemUpdateDto } from './events.dto';

type EventRow = {
  id: string; name: string; tagline: string | null; description: string | null; startDate: Date | null; endDate: Date | null;
  place: string | null; posterUrl: string | null; bannerUrl: string | null; accentColor: string | null; status: string;
  createdById: string | null; createdAt: Date;
};

/** 'YYYY-MM-DD' ou date-heure ISO → Date ; '' → null (effacer) ; invalide → erreur claire. */
function parseDate(v: string | undefined, label: string): Date | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} : date invalide.`);
  return d;
}

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService, private tournaments: TournamentsService) {}

  private assertCanManage(ev: { createdById: string | null }, user: JwtUser) {
    // Propriétaire ou admin, rien d'autre. Un événement sans créateur connu (donnée ancienne ou importée) n'appartient
    // à aucun organisateur : seul un admin peut alors le gérer (auparavant, n'importe quel organisateur le pouvait).
    if (user.role === 'ADMIN') return;
    if (!ev.createdById || ev.createdById !== user.sub) {
      throw new ForbiddenException("Seul l'organisateur de l'événement (ou un admin) peut le gérer.");
    }
  }

  /** Vue publique : sans l'identifiant interne du compte créateur (réservé aux vues de gestion). */
  private publicView(ev: EventRow, cards: { live: boolean; status: string }[]) {
    const { createdById: _owner, ...pub } = this.view(ev, cards);
    void _owner;
    return pub;
  }

  /** Vue commune : champs de l'événement + état calculé (en direct / à venir / terminé) et compteurs. */
  private view(ev: EventRow, cards: { live: boolean; status: string }[]) {
    const now = Date.now();
    const live = cards.some((c) => c.live);
    const end = ev.endDate ?? ev.startDate;
    // Un événement sans tournoi en cours est « terminé » une fois sa date de fin (ou de début, à défaut) passée de
    // plus d'un jour — ou dès que tous ses tournois sont eux-mêmes terminés (ex: joués en avance), sans attendre
    // cette date : sinon un événement entièrement clos reste affiché « à venir » jusqu'à son échéance calendaire.
    const allFinished = cards.length > 0 && cards.every((c) => c.status === 'Terminé');
    const ended = !live && (allFinished || (!!end && end.getTime() + 24 * 3600 * 1000 < now));
    return {
      id: ev.id, name: ev.name, tagline: ev.tagline, description: ev.description,
      startDate: ev.startDate ? ev.startDate.toISOString() : null,
      endDate: ev.endDate ? ev.endDate.toISOString() : null,
      place: ev.place, posterUrl: ev.posterUrl, bannerUrl: ev.bannerUrl, accentColor: ev.accentColor,
      status: ev.status, createdById: ev.createdById,
      state: live ? 'live' : ended ? 'ended' : 'upcoming',
      tournamentCount: cards.length, liveCount: cards.filter((c) => c.live).length,
    };
  }

  private async cardsOf(eventId: string) {
    return this.tournaments.cardsByEvent(eventId);
  }

  async listPublic() {
    const rows = await this.prisma.event.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }] });
    const out = await Promise.all(rows.map(async (r) => this.publicView(r, await this.cardsOf(r.id))));
    // En direct d'abord, puis à venir, puis terminés.
    const rank = { live: 0, upcoming: 1, ended: 2 } as const;
    return out.sort((a, b) => rank[a.state] - rank[b.state]);
  }

  async detailPublic(id: string) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev || ev.status !== 'PUBLISHED') throw new NotFoundException('Événement introuvable.');
    const cards = await this.cardsOf(id);
    return { ...this.publicView(ev, cards), tournaments: cards };
  }

  /** Classement cumulé de l'événement (toutes ses étapes confondues) — public, comme le reste de la fiche. */
  async standings(id: string) {
    const ev = await this.prisma.event.findUnique({ where: { id }, select: { status: true } });
    if (!ev || ev.status !== 'PUBLISHED') throw new NotFoundException('Événement introuvable.');
    return this.tournaments.eventStandings(id);
  }

  async mine(user: JwtUser) {
    const rows = await this.prisma.event.findMany({
      where: user.role === 'ADMIN' ? {} : { createdById: user.sub },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map(async (r) => this.view(r, await this.cardsOf(r.id))));
  }

  async detailForManager(id: string, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    const cards = await this.cardsOf(id);
    // Tournois que l'appelant pourrait encore rattacher (les siens, sans événement).
    const free = await this.prisma.tournament.findMany({
      where: { eventId: null, ...(user.role === 'ADMIN' ? {} : { createdById: user.sub }) },
      orderBy: { createdAt: 'desc' }, select: { id: true, name: true, game: true },
    });
    return { ...this.view(ev, cards), tournaments: cards, attachable: free };
  }

  async create(dto: EventDto, user: JwtUser) {
    // Comme pour les tournois : un organisateur doit avoir été approuvé par l'équipe (l'admin n'est pas soumis à ce contrôle).
    if (user.role === 'ORGANIZER') {
      const u = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { organizerStatus: true } });
      if (!u || u.organizerStatus !== 'APPROVED') {
        throw new ForbiddenException(u?.organizerStatus === 'REJECTED'
          ? "Ta demande d'organisateur a été refusée par l'équipe Miabe."
          : "Ton compte organisateur est en attente de validation par l'équipe Miabe.");
      }
    }
    const start = parseDate(dto.startDate, 'Début');
    const end = parseDate(dto.endDate, 'Fin');
    if (start && end && end < start) throw new BadRequestException('La date de fin est avant la date de début.');
    const ev = await this.prisma.event.create({
      data: {
        name: dto.name.trim(), tagline: dto.tagline?.trim() || null, description: dto.description?.trim() || null,
        startDate: start ?? null, endDate: end ?? null, place: dto.place?.trim() || null,
        posterUrl: dto.posterUrl?.trim() || null, bannerUrl: dto.bannerUrl?.trim() || null,
        accentColor: dto.accentColor?.trim() || null, status: dto.status ?? 'DRAFT', createdById: user.sub,
      },
    });
    return this.view(ev, []);
  }

  async update(id: string, dto: EventUpdateDto, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    const start = parseDate(dto.startDate, 'Début');
    const end = parseDate(dto.endDate, 'Fin');
    const s = start === undefined ? ev.startDate : start;
    const e = end === undefined ? ev.endDate : end;
    if (s && e && e < s) throw new BadRequestException('La date de fin est avant la date de début.');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim() || ev.name;
    if (dto.tagline !== undefined) data.tagline = dto.tagline.trim() || null;
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    if (start !== undefined) data.startDate = start;
    if (end !== undefined) data.endDate = end;
    if (dto.place !== undefined) data.place = dto.place.trim() || null;
    if (dto.posterUrl !== undefined) data.posterUrl = dto.posterUrl.trim() || null;
    if (dto.bannerUrl !== undefined) data.bannerUrl = dto.bannerUrl.trim() || null;
    if (dto.accentColor !== undefined) data.accentColor = dto.accentColor.trim() || null;
    if (dto.status !== undefined) data.status = dto.status;
    const upd = await this.prisma.event.update({ where: { id }, data });
    return this.view(upd, await this.cardsOf(id));
  }

  async remove(id: string, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    await this.prisma.event.delete({ where: { id } }); // les tournois sont détachés (SetNull), jamais supprimés
    return { deleted: true };
  }

  /* ---------- Programme (calendrier géré par l'organisateur) ---------- */

  private scheduleView(items: { id: string; title: string; note: string | null; startAt: Date; endAt: Date | null; tournamentId: string | null; tournament: { id: string; name: string; game: string | null; status: string } | null }[]) {
    return items.map((it) => ({
      id: it.id, title: it.title, note: it.note,
      startAt: it.startAt.toISOString(), endAt: it.endAt ? it.endAt.toISOString() : null,
      tournament: it.tournament ? { id: it.tournament.id, name: it.tournament.name, game: it.tournament.game, live: it.tournament.status === 'LIVE' } : null,
    }));
  }

  /** Programme d'un événement, dans l'ordre chronologique — public dès lors que l'événement l'est. */
  async listSchedule(id: string) {
    const ev = await this.prisma.event.findUnique({ where: { id }, select: { status: true } });
    if (!ev || ev.status !== 'PUBLISHED') throw new NotFoundException('Événement introuvable.');
    const items = await this.prisma.eventScheduleItem.findMany({
      where: { eventId: id }, orderBy: { startAt: 'asc' },
      include: { tournament: { select: { id: true, name: true, game: true, status: true } } },
    });
    return this.scheduleView(items);
  }

  /** Même liste, pour l'organisateur — pas de restriction de visibilité (brouillon compris). */
  async listScheduleForManager(id: string, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    const items = await this.prisma.eventScheduleItem.findMany({
      where: { eventId: id }, orderBy: { startAt: 'asc' },
      include: { tournament: { select: { id: true, name: true, game: true, status: true } } },
    });
    return this.scheduleView(items);
  }

  private async assertTournamentOfEvent(eventId: string, tournamentId: string | undefined) {
    if (!tournamentId) return;
    const t = await this.prisma.tournament.findUnique({ where: { id: tournamentId }, select: { eventId: true } });
    if (!t || t.eventId !== eventId) throw new BadRequestException("Ce tournoi n'est pas rattaché à cet événement.");
  }

  async createScheduleItem(id: string, dto: ScheduleItemDto, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    const startAt = parseDate(dto.startAt, 'Date de début');
    if (!startAt) throw new BadRequestException('Date de début invalide.');
    const endAt = parseDate(dto.endAt, 'Date de fin');
    if (endAt && endAt < startAt) throw new BadRequestException('La fin est avant le début.');
    await this.assertTournamentOfEvent(id, dto.tournamentId);
    await this.prisma.eventScheduleItem.create({
      data: { eventId: id, title: dto.title.trim(), note: dto.note?.trim() || null, startAt, endAt: endAt ?? null, tournamentId: dto.tournamentId || null },
    });
    return this.listScheduleForManager(id, user);
  }

  async updateScheduleItem(id: string, itemId: string, dto: ScheduleItemUpdateDto, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    const item = await this.prisma.eventScheduleItem.findUnique({ where: { id: itemId } });
    if (!item || item.eventId !== id) throw new NotFoundException('Point du programme introuvable.');
    const startAt = parseDate(dto.startAt, 'Date de début');
    const endAt = parseDate(dto.endAt, 'Date de fin');
    const nextStart = startAt ?? item.startAt;
    const nextEnd = endAt === undefined ? item.endAt : endAt;
    if (nextEnd && nextEnd < nextStart) throw new BadRequestException('La fin est avant le début.');
    if (dto.tournamentId !== undefined) await this.assertTournamentOfEvent(id, dto.tournamentId || undefined);
    await this.prisma.eventScheduleItem.update({
      where: { id: itemId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        ...(startAt ? { startAt } : {}),
        ...(endAt !== undefined ? { endAt } : {}),
        ...(dto.tournamentId !== undefined ? { tournamentId: dto.tournamentId || null } : {}),
      },
    });
    return this.listScheduleForManager(id, user);
  }

  async deleteScheduleItem(id: string, itemId: string, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    const item = await this.prisma.eventScheduleItem.findUnique({ where: { id: itemId } });
    if (!item || item.eventId !== id) throw new NotFoundException('Point du programme introuvable.');
    await this.prisma.eventScheduleItem.delete({ where: { id: itemId } });
    return this.listScheduleForManager(id, user);
  }

  async attachTournament(id: string, tid: string, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    const t = await this.prisma.tournament.findUnique({ where: { id: tid }, select: { id: true, createdById: true, eventId: true, publication: true, status: true } });
    if (!t) throw new NotFoundException('Tournoi introuvable.');
    if (t.createdById && t.createdById !== user.sub && user.role !== 'ADMIN') {
      throw new ForbiddenException('Tu ne peux rattacher que tes propres tournois.');
    }
    // Un essai en cours ou terminé deviendrait public avec l'événement.
    if (!t.eventId && t.publication === 'DRAFT' && t.status !== 'DRAFT') throw new ConflictException("Ce tournoi a été lancé en essai : réinitialise-le avant de le rattacher à un événement.");
    await this.prisma.tournament.update({ where: { id: tid }, data: { eventId: id } });
    return { attached: true };
  }

  async detachTournament(id: string, tid: string, user: JwtUser) {
    const ev = await this.prisma.event.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Événement introuvable.');
    this.assertCanManage(ev, user);
    await this.prisma.tournament.updateMany({ where: { id: tid, eventId: id }, data: { eventId: null } });
    return { detached: true };
  }
}
