import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { DashboardService } from './dashboard.service';
import { NewsDto, NewsUpdateDto, OrderStatusDto, ProductDto, ProductUpdateDto, ReviewOrganizerDto, SetRoleDto } from './admin.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AssociationsService } from '../associations/associations.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly dashboard: DashboardService, private readonly associations: AssociationsService) {}

  /** Tableau de bord de pilotage (temps réel) — réservé à l'admin comme tout ce contrôleur. */
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

  /* ---------- Demandes de club (validation avant entrée dans le catalogue) ---------- */

  @Get('club-requests')
  clubRequests() {
    return this.admin.listClubRequests();
  }

  /* ---------- Intégration des associations ---------- */

  @Get('associations')
  pendingAssociations() {
    return this.associations.listPending();
  }

  @Post('associations/:id/:decision')
  reviewAssociation(@Param('id') id: string, @Param('decision') decision: string) {
    return this.associations.review(id, decision === 'approve');
  }

  @Post('club-requests/:id/:decision')
  reviewClub(@Param('id') id: string, @Param('decision') decision: string) {
    return this.admin.reviewClubRequest(id, decision === 'approve' ? 'APPROVED' : 'REJECTED');
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
  orders() {
    return this.admin.recentOrders();
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
