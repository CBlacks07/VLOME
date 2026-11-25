import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { JoinClubDto, ReviewDecisionDto } from './associations.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

/** Bloc « Mon club » du joueur : tout compte connecté, et seulement sur sa propre fiche. */
@Controller('membership')
@UseGuards(JwtAuthGuard)
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.membership.overview(user.sub);
  }

  @Post('request')
  request(@CurrentUser() user: JwtUser, @Body() dto: JoinClubDto) {
    return this.membership.request(user.sub, dto.clubId);
  }

  @Delete('request')
  cancel(@CurrentUser() user: JwtUser) {
    return this.membership.cancelRequest(user.sub);
  }

  @Post('leave')
  leave(@CurrentUser() user: JwtUser) {
    return this.membership.leave(user.sub);
  }

  @Post('invites/:membershipId')
  answer(@CurrentUser() user: JwtUser, @Param('membershipId') membershipId: string, @Body() dto: ReviewDecisionDto) {
    return this.membership.answerInvite(user.sub, membershipId, dto.decision === 'approve');
  }
}
