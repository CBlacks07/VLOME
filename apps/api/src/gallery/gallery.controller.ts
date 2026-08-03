import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { AlbumDto, GalleryItemDto } from './gallery.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@Controller('gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  list() {
    return this.gallery.list();
  }

  /* ---------- Catalogues (albums) ---------- */

  // Déclaré avant ':id' n'est pas nécessaire ici (chemins distincts), mais on garde les albums groupés.
  @Get('albums')
  albums() {
    return this.gallery.listAlbums();
  }

  @Post('albums')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  createAlbum(@Body() dto: AlbumDto) {
    return this.gallery.createAlbum(dto);
  }

  @Patch('albums/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updateAlbum(@Param('id') id: string, @Body() dto: AlbumDto) {
    return this.gallery.updateAlbum(id, dto);
  }

  @Delete('albums/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  removeAlbum(@Param('id') id: string) {
    return this.gallery.removeAlbum(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: GalleryItemDto) {
    return this.gallery.create(dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.gallery.remove(id);
  }
}
