import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NewsDto, NewsUpdateDto, ProductDto, ProductUpdateDto } from './admin.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  /* ---------- Utilisateurs ---------- */

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
    const [users, tournaments, orders, products, admins, organizers, news] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.tournament.count(),
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.user.count({ where: { role: 'ORGANIZER' } }),
      this.prisma.newsPost.count(),
    ]);
    return { users, admins, organizers, tournaments, orders, products, news };
  }

  /* ---------- Actualités ---------- */

  private slugify(title: string) {
    const base = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'article';
    return `${base}-${Date.now().toString(36)}`;
  }

  listNews() {
    return this.prisma.newsPost.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createNews(dto: NewsDto) {
    return this.prisma.newsPost.create({
      data: {
        title: dto.title.trim(), slug: this.slugify(dto.title),
        category: dto.category.trim() || 'Actualité', body: dto.body,
        published: dto.published ?? true,
      },
    });
  }

  async updateNews(id: string, dto: NewsUpdateDto) {
    const n = await this.prisma.newsPost.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Article introuvable');
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title.trim() || n.title;
    if (dto.category !== undefined) data.category = dto.category.trim() || n.category;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.published !== undefined) data.published = dto.published;
    return this.prisma.newsPost.update({ where: { id }, data });
  }

  async deleteNews(id: string) {
    const n = await this.prisma.newsPost.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Article introuvable');
    await this.prisma.newsPost.delete({ where: { id } });
    return { deleted: true };
  }

  /* ---------- Produits ---------- */

  listProducts() {
    return this.prisma.product.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  createProduct(dto: ProductDto) {
    return this.prisma.product.create({
      data: {
        name: dto.name.trim(), category: dto.category.trim() || 'Goodies',
        priceXof: dto.priceXof, stock: dto.stock, imageUrl: dto.imageUrl || null,
      },
    });
  }

  async updateProduct(id: string, dto: ProductUpdateDto) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Produit introuvable');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim() || p.name;
    if (dto.category !== undefined) data.category = dto.category.trim() || p.category;
    if (dto.priceXof !== undefined) data.priceXof = dto.priceXof;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl || null;
    return this.prisma.product.update({ where: { id }, data });
  }

  async deleteProduct(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Produit introuvable');
    await this.prisma.product.delete({ where: { id } });
    return { deleted: true };
  }

  /* ---------- Commandes ---------- */

  recentOrders() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { email: true, displayName: true } } },
    });
  }

  async setOrderStatus(id: string, status: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Commande introuvable');
    return this.prisma.order.update({ where: { id }, data: { status } });
  }
}
