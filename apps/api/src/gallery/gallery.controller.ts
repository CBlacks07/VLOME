import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { GalleryService } from './gallery.service';
import { GalleryItemDto } from './gallery.dto';
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
