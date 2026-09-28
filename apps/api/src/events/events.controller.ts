import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventDto, EventUpdateDto, ScheduleItemDto, ScheduleItemUpdateDto } from './events.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /* ---------- Public ---------- */

  @Get()
  list() {
    return this.events.listPublic();
  }

  /* Déclarées avant ':id' pour ne pas être capturées par la route paramétrée. */

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  mine(@CurrentUser() user: JwtUser) {
    return this.events.mine(user);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.events.detailPublic(id);
  }

  @Get(':id/standings')
  standings(@Param('id') id: string) {
    return this.events.standings(id);
  }

  @Get(':id/schedule')
  schedule(@Param('id') id: string) {
    return this.events.listSchedule(id);
  }

  @Get(':id/schedule/manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  scheduleForManager(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.events.listScheduleForManager(id, user);
  }

  @Post(':id/schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  createScheduleItem(@Param('id') id: string, @Body() dto: ScheduleItemDto, @CurrentUser() user: JwtUser) {
    return this.events.createScheduleItem(id, dto, user);
  }

  @Patch(':id/schedule/:itemId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  updateScheduleItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: ScheduleItemUpdateDto, @CurrentUser() user: JwtUser) {
    return this.events.updateScheduleItem(id, itemId, dto, user);
  }

  @Delete(':id/schedule/:itemId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  deleteScheduleItem(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentUser() user: JwtUser) {
    return this.events.deleteScheduleItem(id, itemId, user);
  }

  /* ---------- Gestion (organisateur propriétaire ou admin) ---------- */

  @Get(':id/manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  manage(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.events.detailForManager(id, user);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  create(@Body() dto: EventDto, @CurrentUser() user: JwtUser) {
    return this.events.create(dto, user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  update(@Param('id') id: string, @Body() dto: EventUpdateDto, @CurrentUser() user: JwtUser) {
    return this.events.update(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.events.remove(id, user);
  }

  @Post(':id/tournaments/:tid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  attach(@Param('id') id: string, @Param('tid') tid: string, @CurrentUser() user: JwtUser) {
    return this.events.attachTournament(id, tid, user);
  }

  @Delete(':id/tournaments/:tid')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  detach(@Param('id') id: string, @Param('tid') tid: string, @CurrentUser() user: JwtUser) {
    return this.events.detachTournament(id, tid, user);
  }
}
