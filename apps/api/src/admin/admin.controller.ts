import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { DashboardService } from './dashboard.service';
import { ArchiveOrderDto, NewsDto, NewsUpdateDto, OrderStatusDto, ProductDto, ProductUpdateDto, ReviewOrganizerDto, SetRoleDto } from './admin.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AssociationsService } from '../associations/associations.service';
import { MailService } from '../mail/mail.service';
import { PaymentsService } from '../payments/payments.service';
import { AddMemberDto, AttachOwnerDto, MergeClubDto } from '../associations/associations.dto';
import { MembershipService } from '../associations/membership.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly dashboard: DashboardService, private readonly associations: AssociationsService, private readonly mail: MailService, private readonly onlinePayments: PaymentsService, private readonly membership: MembershipService) {}

  /** Tableau de bord de pilotage (temps réel) — réservé à l'admin comme tout ce contrôleur. */
  /** Messagerie : réglages présents + connexion SMTP (sans envoyer). */
  @Get('mail')
  mailStatus() {
    return this.mail.diagnose();
  }

  /** Envoie un e-mail de test à l'adresse du compte admin connecté. */
  @Post('mail/test')
  mailTest(@CurrentUser() user: JwtUser) {
    return this.mail.diagnose(user.email);
  }

  @Get('dashboard')
  dashboardData() {
    return this.dashboard.get();
  }

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  /* ---------- Utilisateurs ---------- */

  @Get('users')
  users() {
    return this.admin.listUsers();
  }

  @Patch('users/:id/role')
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.admin.setRole(id, dto.role);
  }

  @Post('users/:id/reset-password')
  resetUserPassword(@Param('id') id: string) {
    return this.admin.resetUserPassword(id);
  }

  @Delete('users/:id')
  removeUser(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.admin.removeUser(id, user.sub);
  }

  /* ---------- Clubs & associations ---------- */

  @Get('clubs-overview')
  clubsOverview() {
    return this.associations.overview();
  }

  @Get('clubs/:id')
  clubDetail(@Param('id') id: string) {
    return this.associations.detail(id);
  }

  @Delete('clubs/:id')
  removeClub(@Param('id') id: string) {
    return this.associations.removeClub(id);
  }

  @Post('clubs/:id/merge')
  mergeClub(@Param('id') id: string, @Body() dto: MergeClubDto) {
    return this.associations.merge(id, dto.targetId);
  }

  @Post('clubs/:id/members')
  addClubMember(@Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.associations.adminAddMember(id, dto.playerId);
  }

  @Delete('clubs/:id/members/:playerId')
  removeClubMember(@Param('id') id: string, @Param('playerId') playerId: string) {
    return this.associations.adminRemoveMember(id, playerId);
  }

  @Post('claims/:playerId/:decision')
  reviewClaim(@Param('playerId') playerId: string, @Param('decision') decision: string) {
    return this.membership.reviewClaim(playerId, decision === 'approve');
  }

  @Post('associations/:id/attach-owner')
  attachOwner(@Param('id') id: string, @Body() dto: AttachOwnerDto) {
    return this.associations.attachOwner(id, dto.email, !!dto.replace);
  }

  @Delete('associations/:id/owner')
  detachOwner(@Param('id') id: string) {
    return this.associations.detachOwner(id);
  }

  @Post('associations/:id/:decision')
  reviewAssociation(@Param('id') id: string, @Param('decision') decision: string) {
    return this.associations.review(id, decision === 'approve');
  }

  /* ---------- Organisateurs (validation, plafonds) ---------- */

  @Get('organizers')
  organizers() {
    return this.admin.listOrganizers();
  }

  @Patch('organizers/:id/review')
  reviewOrganizer(@Param('id') id: string, @Body() dto: ReviewOrganizerDto) {
    return this.admin.reviewOrganizer(id, dto.status, dto.maxTournaments, dto.maxPlayers);
  }

  /* ---------- Actualités ---------- */

  @Get('news')
  news() {
    return this.admin.listNews();
  }

  @Post('news')
  createNews(@Body() dto: NewsDto) {
    return this.admin.createNews(dto);
  }

  @Patch('news/:id')
  updateNews(@Param('id') id: string, @Body() dto: NewsUpdateDto) {
    return this.admin.updateNews(id, dto);
  }

  @Delete('news/:id')
  deleteNews(@Param('id') id: string) {
    return this.admin.deleteNews(id);
  }

  /* ---------- Produits ---------- */

  @Get('products')
  products() {
    return this.admin.listProducts();
  }

  @Post('products')
  createProduct(@Body() dto: ProductDto) {
    return this.admin.createProduct(dto);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: ProductUpdateDto) {
    return this.admin.updateProduct(id, dto);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.admin.deleteProduct(id);
  }

  /* ---------- Réglages du site ---------- */

  @Get('settings')
  settings() {
    return this.admin.getSettings();
  }

  @Patch('settings/:key')
  setSetting(@Param('key') key: string, @Body() body: { value: unknown }) {
    return this.admin.setSetting(key, body?.value);
  }

  /* ---------- Paiements d'inscription ---------- */

  @Get('payments')
  payments() {
    return this.admin.listPayments();
  }

  /* ---------- Commandes ---------- */

  @Get('orders')
  async orders() {
    // Statuts alignés sur la réalité des paiements (payé / refusé / abandonné) avant d'afficher la liste.
    await this.onlinePayments.reconcile().catch(() => undefined);
    return this.admin.recentOrders();
  }

  @Patch('orders/:id/archive')
  archiveOrder(@Param('id') id: string, @Body() dto: ArchiveOrderDto) {
    return this.admin.setOrderArchived(id, dto.archived);
  }

  @Delete('orders/:id')
  deleteOrder(@Param('id') id: string) {
    return this.admin.deleteOrder(id);
  }

  @Patch('orders/:id/status')
  setOrderStatus(@Param('id') id: string, @Body() dto: OrderStatusDto) {
    return this.admin.setOrderStatus(id, dto.status);
  }

  /* ---------- Crédits organisateur ---------- */

  @Get('credit-purchases')
  pendingCreditPurchases() {
    return this.admin.pendingCreditPurchases();
  }

  @Post('credit-purchases/:id/confirm')
  confirmCreditPurchase(@Param('id') id: string) {
    return this.admin.confirmCreditPurchase(id);
  }
}
