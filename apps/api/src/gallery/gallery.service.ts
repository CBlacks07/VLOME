import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GalleryItemDto } from './gallery.dto';

@Injectable()
export class GalleryService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.galleryItem.findMany({
      orderBy: { createdAt: 'desc' },
      include: { tournament: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({
      id: r.id, title: r.title, mediaUrl: r.mediaUrl, mediaType: r.mediaType,
      tournament: r.tournament ? { id: r.tournament.id, name: r.tournament.name } : null,
      createdAt: r.createdAt,
    }));
  }

  create(dto: GalleryItemDto) {
    return this.prisma.galleryItem.create({
      data: {
        title: dto.title.trim(), mediaUrl: dto.mediaUrl,
        mediaType: dto.mediaType ?? (/\.(mp4|webm)$/i.test(dto.mediaUrl) ? 'video' : 'image'),
        tournamentId: dto.tournamentId || null,
      },
    });
  }

  async remove(id: string) {
    const item = await this.prisma.galleryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Élément de galerie introuvable');
    await this.prisma.galleryItem.delete({ where: { id } });
    return { deleted: true };
  }
}
