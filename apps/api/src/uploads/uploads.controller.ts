import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

// Dossier local des fichiers envoyés (servi statiquement sous /uploads) — utilisé uniquement en dev,
// quand CLOUDINARY_URL n'est pas défini. En production (Vercel), le système de fichiers est en lecture
// seule hors /tmp : les fichiers vont sur Cloudinary (stockage image/vidéo) à la place. Le SDK Cloudinary
// se configure tout seul depuis process.env.CLOUDINARY_URL, pas d'appel .config() nécessaire.
export const UPLOADS_DIR = join(process.cwd(), 'uploads');
const USE_CLOUDINARY = !!process.env.CLOUDINARY_URL;

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm'];
const VIDEO_EXT = ['.mp4', '.webm'];
// 4 Mo : en production l'API tourne en fonction serverless (Vercel), dont le corps de requête est
// refusé au-delà d'environ 4,5 Mo par la plateforme elle-même (413 FUNCTION_PAYLOAD_TOO_LARGE),
// avant même d'arriver ici. Annoncer plus haut ne servirait qu'à produire des échecs incompréhensibles.
const MAX_SIZE = 4 * 1024 * 1024;

function randomFilename(originalname: string): string {
  const ext = extname(originalname).toLowerCase();
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${ext}`;
}

function uploadToCloudinary(buffer: Buffer, publicId: string, resourceType: 'image' | 'video'): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, public_id: publicId, folder: 'vlome' },
      (err, result?: UploadApiResponse) => (err || !result ? reject(err) : resolve(result.secure_url)),
    );
    Readable.from(buffer).pipe(stream);
  });
}

@Controller('uploads')
export class UploadsController {
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: USE_CLOUDINARY
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
    if (USE_CLOUDINARY) {
      const ext = extname(file.originalname).toLowerCase();
      const publicId = randomFilename(file.originalname).slice(0, -ext.length);
      const isVideo = VIDEO_EXT.includes(ext);
      try {
        const url = await uploadToCloudinary(file.buffer, publicId, isVideo ? 'video' : 'image');
        return { url };
      } catch (e) {
        // Le stockage refuse le fichier (format illisible, vidéo corrompue…) : message clair plutôt qu'un « 500 ».
        const reason = (e as { message?: string } | null)?.message || 'fichier refusé';
        throw new BadRequestException(
          isVideo
            ? `La vidéo n'a pas pu être enregistrée (${reason}). Utilise un fichier .mp4 (H.264) ou .webm valide de 4 Mo maximum.`
            : `L'image n'a pas pu être enregistrée (${reason}).`,
        );
      }
    }
    return { url: `/uploads/${file.filename}` };
  }
}
