import type { PrismaService } from '../prisma/prisma.service';

/** « Gouzepe Gaming Club » → « gouzepe-gaming-club » (sans accents ni caractères spéciaux). */
export function slugify(name: string): string {
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 50) || 'club';
}

/** Adresse publique unique d'un club : le slug du nom, suffixé d'un nombre si déjà pris. */
export async function uniqueClubSlug(prisma: PrismaService, name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.club.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
