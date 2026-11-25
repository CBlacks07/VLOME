import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AssociationsService } from './associations.service';
import { InviteDto, ReviewDecisionDto, UpdateAssociationDto } from './associations.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';

@Controller()
export class AssociationsController {
  constructor(private readonly assoc: AssociationsService) {}

  /* Lecture publique : liste des clubs validés (inscription) et données d'une association (pages/widgets embarqués). */

  @Get('public/clubs')
  publicClubs() {
    return this.assoc.publicClubs();
  }

  @Get('public/clubs/:slug')
  publicClub(@Param('slug') slug: string) {
    return this.assoc.publicClub(slug);
  }

  /* Espace « Mon club » : le compte responsable d'un club (association, ou organisateur/admin rattaché) — le service vérifie la propriété. */

  @Get('association/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ASSOCIATION', 'ORGANIZER', 'ADMIN')
  me(@CurrentUser() user: JwtUser) {
    return this.assoc.me(user.sub);
  }

  @Patch('association/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ASSOCIATION', 'ORGANIZER', 'ADMIN')
  update(@CurrentUser() user: JwtUser, @Body() dto: UpdateAssociationDto) {
    return this.assoc.updateMe(user.sub, dto);
  }

  @Post('association/requests/:membershipId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ASSOCIATION', 'ORGANIZER', 'ADMIN')
  review(@CurrentUser() user: JwtUser, @Param('membershipId') membershipId: string, @Body() dto: ReviewDecisionDto) {
    return this.assoc.reviewMember(user.sub, membershipId, dto.decision === 'approve');
  }

  @Get('association/candidates')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ASSOCIATION', 'ORGANIZER', 'ADMIN')
  candidates(@CurrentUser() user: JwtUser, @Query('q') q?: string) {
    return this.assoc.candidates(user.sub, q || '');
  }

  @Post('association/invites')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ASSOCIATION', 'ORGANIZER', 'ADMIN')
  invite(@CurrentUser() user: JwtUser, @Body() dto: InviteDto) {
    return this.assoc.invite(user.sub, dto);
  }

  @Delete('association/invites/:membershipId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ASSOCIATION', 'ORGANIZER', 'ADMIN')
  cancelInvite(@CurrentUser() user: JwtUser, @Param('membershipId') membershipId: string) {
    return this.assoc.cancelInvite(user.sub, membershipId);
  }

  @Delete('association/members/:playerId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ASSOCIATION', 'ORGANIZER', 'ADMIN')
  removeMember(@CurrentUser() user: JwtUser, @Param('playerId') playerId: string) {
    return this.assoc.removeMember(user.sub, playerId);
  }
}
