import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './shop.dto';

const DEMO_PRODUCTS = [
  { name: 'Maillot officiel VLOME', category: 'Vêtements', priceXof: 15000, stock: 50 },
  { name: 'Hoodie Team Mawu', category: 'Vêtements', priceXof: 25000, stock: 30 },
  { name: 'Casquette VLOME', category: 'Goodies', priceXof: 8000, stock: 80 },
  { name: 'Mug gamer édition Lomé', category: 'Goodies', priceXof: 5000, stock: 120 },
  { name: 'Tapis de souris XL', category: 'Goodies', priceXof: 12000, stock: 60 },
  { name: 'Billet Survival Cup', category: 'Billets', priceXof: 3000, stock: 200 },
  { name: 'Pass LAN Gaming Arena', category: 'Billets', priceXof: 6000, stock: 150 },
  { name: 'Carte cadeau 10 000 F', category: 'Cartes cadeaux', priceXof: 10000, stock: 999 },
];

@Injectable()
export class ShopService {
  constructor(private prisma: PrismaService) {}

  async listProducts() {
    return this.prisma.product.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async seedProducts() {
    const count = await this.prisma.product.count();
    if (count > 0) return { seeded: false, count };
    await this.prisma.product.createMany({ data: DEMO_PRODUCTS });
    return { seeded: true, count: DEMO_PRODUCTS.length };
  }

  async createOrder(dto: CreateOrderDto, userId?: string) {
    const total = dto.items.reduce((a, i) => a + i.priceXof, 0);
    const reference = 'VL-' + Date.now().toString(36).toUpperCase();
    const order = await this.prisma.order.create({
      data: {
        reference, totalXof: total, paymentMethod: dto.paymentMethod, status: 'pending',
        userId: userId ?? null,
        items: dto.items.map((i) => ({ name: i.name, price: i.priceXof })),
      },
    });
    return { id: order.id, reference: order.reference, totalXof: order.totalXof, paymentMethod: order.paymentMethod, status: order.status };
  }
}
