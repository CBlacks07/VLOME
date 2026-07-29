import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { put } from '@vercel/blob';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

// Dossier local des fichiers envoyés (servi statiquement sous /uploads) — utilisé uniquement en dev,
// quand BLOB_READ_WRITE_TOKEN n'est pas défini. En production (Vercel), le système de fichiers est en
// lecture seule hors /tmp : les fichiers vont sur Vercel Blob (stockage objet) à la place.
export const UPLOADS_DIR = join(process.cwd(), 'uploads');
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm'];
const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo (vidéos de fond incluses)

function randomFilename(originalname: string): string {
  const ext = extname(originalname).toLowerCase();
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${ext}`;
}

@Controller('uploads')
export class UploadsController {
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: USE_BLOB
        ? memoryStorage()
        : diskStorage({
            destination: (_req, _file, cb) => {
              if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
              cb(null, UPLOADS_DIR);
            },
            filename: (_req, file, cb) => cb(null, randomFilename(file.originalname)),
          }),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED.includes(ext)) return cb(new BadRequestException('Format non supporté (jpg, png, webp, gif, mp4, webm).'), false);
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    if (USE_BLOB) {
      const blob = await put(randomFilename(file.originalname), file.buffer, { access: 'public', addRandomSuffix: false });
      return { url: blob.url };
    }
    return { url: `/uploads/${file.filename}` };
  }
}
