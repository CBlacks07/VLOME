import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { NewsDto, NewsUpdateDto, OrderStatusDto, ProductDto, ProductUpdateDto, SetRoleDto } from './admin.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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

  /* ---------- Commandes ---------- */

  @Get('orders')
  orders() {
    return this.admin.recentOrders();
  }

  @Patch('orders/:id/status')
  setOrderStatus(@Param('id') id: string, @Body() dto: OrderStatusDto) {
    return this.admin.setOrderStatus(id, dto.status);
  }
}
