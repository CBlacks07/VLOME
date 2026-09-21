import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventDto, EventUpdateDto } from './events.dto';
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
