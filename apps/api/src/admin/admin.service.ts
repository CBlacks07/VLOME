import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true },
    });
  }

  setRole(id: string, role: string) {
    return this.prisma.user.update({
      where: { id },
      data: { role: role as any },
      select: { id: true, email: true, displayName: true, role: true },
    });
  }

  async overview() {
    const [users, tournaments, orders, products, admins, organizers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.tournament.count(),
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.user.count({ where: { role: 'ORGANIZER' } }),
    ]);
    return { users, admins, organizers, tournaments, orders, products };
  }

  recentOrders() {
    return this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  }
}
