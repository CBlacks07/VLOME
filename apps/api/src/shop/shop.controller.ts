import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ShopService } from './shop.service';
import { CreateOrderDto } from './shop.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtUser } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

@Controller()
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('products')
  products() {
    return this.shop.listProducts();
  }

  @Post('products/seed')
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
