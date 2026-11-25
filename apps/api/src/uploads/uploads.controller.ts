import { BadRequestException, Controller, Delete, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname, join } from 'path';
import { closeSync, existsSync, mkdirSync, openSync, readSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtUser } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

// Dossier local des fichiers envoyés (servi statiquement sous /uploads) — utilisé uniquement en dev,
// quand CLOUDINARY_URL n'est pas défini. En production (Vercel), le système de fichiers est en lecture
// seule hors /tmp : les fichiers vont sur Cloudinary (stockage image/vidéo) à la place. Le SDK Cloudinary
// se configure tout seul depuis process.env.CLOUDINARY_URL, pas d'appel .config() nécessaire.
export const UPLOADS_DIR = join(process.cwd(), 'uploads');
const USE_CLOUDINARY = !!process.env.CLOUDINARY_URL;

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm'];
const VIDEO_EXT = ['.mp4', '.webm'];
const AVATAR_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
// 4 Mo : en production l'API tourne en fonction serverless (Vercel), dont le corps de requête est
// refusé au-delà d'environ 4,5 Mo par la plateforme elle-même (413 FUNCTION_PAYLOAD_TOO_LARGE),
// avant même d'arriver ici. Annoncer plus haut ne servirait qu'à produire des échecs incompréhensibles.
const MAX_SIZE = 4 * 1024 * 1024;

function randomFilename(originalname: string): string {
  const ext = extname(originalname).toLowerCase();
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${ext}`;
}

/** Reconnaît une vraie image à ses premiers octets (JPEG, PNG ou WebP) : l'extension seule ne prouve rien. */
export function looksLikeImage(head: Buffer): boolean {
  const jpeg = head.length > 2 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const png = head.length > 7 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = head.length > 11 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  return jpeg || png || webp;
}

function storage() {
  return USE_CLOUDINARY
    ? memoryStorage()
    : diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
          cb(null, UPLOADS_DIR);
        },
        filename: (_req, file, cb) => cb(null, randomFilename(file.originalname)),
      });
}

function uploadToCloudinary(buffer: Buffer, publicId: string, resourceType: 'image' | 'video', square = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      // Photo de profil : toujours ramenée à un carré de 512 px, recadré sur le visage quand il y en a un.
      { resource_type: resourceType, public_id: publicId, folder: square ? 'vlome/avatars' : 'vlome', ...(square ? { transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'face' }] } : {}) },
      (err, result?: UploadApiResponse) => (err || !result ? reject(err) : resolve(result.secure_url)),
    );
    Readable.from(buffer).pipe(stream);
  });
}

@Controller('uploads')
export class UploadsController {
  constructor(private prisma: PrismaService) {}

  /** Photo de profil : ouverte à tout compte connecté, et pour lui seul. L'adresse est enregistrée par le serveur,
   *  un compte ne peut donc pas faire pointer sa photo vers une image extérieure. */
  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: storage(),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!AVATAR_EXT.includes(extname(file.originalname).toLowerCase())) return cb(new BadRequestException('Choisis une photo au format jpg, png ou webp.'), false);
        cb(null, true);
      },
    }),
  )
  async avatar(@CurrentUser() user: JwtUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    let url: string;
    if (USE_CLOUDINARY) {
      if (!looksLikeImage(file.buffer)) throw new BadRequestException("Ce fichier n'est pas une image lisible.");
      try {
        url = await uploadToCloudinary(file.buffer, randomFilename(file.originalname).replace(/\.[^.]+$/, ''), 'image', true);
      } catch (e) {
        throw new BadRequestException(`La photo n'a pas pu être enregistrée (${(e as { message?: string } | null)?.message || 'fichier refusé'}).`);
      }
    } else {
      const head = Buffer.alloc(12);
      const fd = openSync(file.path, 'r');
      try { readSync(fd, head, 0, 12, 0); } finally { closeSync(fd); }
      if (!looksLikeImage(head)) {
        unlinkSync(file.path);
        throw new BadRequestException("Ce fichier n'est pas une image lisible.");
      }
      url = `/uploads/${file.filename}`;
    }
    await this.prisma.user.update({ where: { id: user.sub }, data: { avatarUrl: url } });
    return { url };
  }

  @Delete('avatar')
  @UseGuards(JwtAuthGuard)
  async removeAvatar(@CurrentUser() user: JwtUser) {
    await this.prisma.user.update({ where: { id: user.sub }, data: { avatarUrl: null } });
    return { url: null };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ORGANIZER', 'ADMIN', 'ASSOCIATION')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: storage(),
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
