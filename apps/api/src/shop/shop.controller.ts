import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ShopService } from './shop.service';
import { CreateOrderDto } from './shop.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller()
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('products')
  products() {
    return this.shop.listProducts();
  }

  // Réservé à l'admin : n'insère les produits de démo que si la table est vide (voir
  // ShopService.seedProducts), mais reste une écriture en base — jamais accessible sans
  // authentification (voir le même garde sur /tournaments/seed et /news/seed).
  @Post('products/seed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  seed() {
    return this.shop.seedProducts();
  }

  // La commande nécessite d'être connecté ; elle est rattachée au compte.
  @Post('orders')
  @UseGuards(JwtAuthGuard)
  order(@Body() dto: CreateOrderDto, @CurrentUser() user: JwtUser) {
    return this.shop.createOrder(dto, user.sub);
  }
}
