import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { ChangePasswordDto, UpdateMeDto } from './users.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.users.me(user.sub);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: JwtUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.sub, dto);
  }

  @Patch('me/password')
  changePassword(@CurrentUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    return this.users.changePassword(user.sub, dto);
  }

  @Get('me/registrations')
  myRegistrations(@CurrentUser() user: JwtUser) {
    return this.users.myRegistrations(user.sub);
  }

  @Get('me/orders')
  myOrders(@CurrentUser() user: JwtUser) {
    return this.users.myOrders(user.sub);
  }

  @Get('me/results')
  myResults(@CurrentUser() user: JwtUser) {
    return this.users.myResults(user.sub);
  }
}
