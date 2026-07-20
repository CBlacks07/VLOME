import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

// Dossier local des fichiers envoyés (servi statiquement sous /uploads).
// À remplacer par Cloudflare R2 en production.
export const UPLOADS_DIR = join(process.cwd(), 'uploads');

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm'];
const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo (vidéos de fond incluses)

@Controller('uploads')
export class UploadsController {
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
          cb(null, UPLOADS_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase();
          cb(null, `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${ext}`);
        },
      }),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED.includes(ext)) return cb(new BadRequestException('Format non supporté (jpg, png, webp, gif, mp4, webm).'), false);
        cb(null, true);
      },
    }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return { url: `/uploads/${file.filename}` };
  }
}
