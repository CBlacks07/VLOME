import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlbumDto, GalleryItemDto } from './gallery.dto';

@Injectable()
export class GalleryService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.galleryItem.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        tournament: { select: { id: true, name: true } },
        album: { select: { id: true, title: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id, title: r.title, mediaUrl: r.mediaUrl, mediaType: r.mediaType,
      tournament: r.tournament ? { id: r.tournament.id, name: r.tournament.name } : null,
      album: r.album ? { id: r.album.id, title: r.album.title } : null,
      albumId: r.albumId,
      createdAt: r.createdAt,
    }));
  }

  /** Catalogues avec leur nombre de médias et une vignette de couverture (média le plus récent). */
  async listAlbums() {
    const rows = await this.prisma.galleryAlbum.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        items: { orderBy: { createdAt: 'desc' }, select: { mediaUrl: true, mediaType: true } },
      },
    });
    return rows.map((a) => {
      const cover = a.items.find((i) => i.mediaType === 'image') ?? a.items[0];
      return {
        id: a.id, title: a.title, description: a.description,
        count: a.items.length, coverUrl: cover?.mediaUrl ?? null,
        createdAt: a.createdAt,
      };
    });
  }

  createAlbum(dto: AlbumDto) {
    return this.prisma.galleryAlbum.create({
      data: { title: dto.title.trim(), description: dto.description?.trim() || null },
    });
  }

  async updateAlbum(id: string, dto: AlbumDto) {
    const a = await this.prisma.galleryAlbum.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Catalogue introuvable');
    return this.prisma.galleryAlbum.update({
      where: { id },
      data: { title: dto.title.trim(), description: dto.description?.trim() || null },
    });
  }

  /** Supprime le catalogue seulement : ses médias sont conservés et repassent « hors catalogue ». */
  async removeAlbum(id: string) {
    const a = await this.prisma.galleryAlbum.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Catalogue introuvable');
    await this.prisma.galleryAlbum.delete({ where: { id } });
    return { deleted: true };
  }

  create(dto: GalleryItemDto) {
    return this.prisma.galleryItem.create({
      data: {
        title: dto.title.trim(), mediaUrl: dto.mediaUrl,
        mediaType: dto.mediaType ?? (/\.(mp4|webm)$/i.test(dto.mediaUrl) ? 'video' : 'image'),
        tournamentId: dto.tournamentId || null,
        albumId: dto.albumId || null,
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
