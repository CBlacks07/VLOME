import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEMO_NEWS = [
  {
    title: 'EA FC 26 : le patch qui change la méta au Togo',
    category: 'EA FC',
    body: 'Le dernier patch d\'EA FC 26 rebat les cartes de la méta compétitive. Les joueurs togolais adaptent déjà leurs compositions avant les prochaines qualifications VLOME.',
  },
  {
    title: 'VLOME signe un partenariat avec Gaming Arena Lomé',
    category: 'Esport Togo',
    body: 'La plateforme VLOME et la Gaming Arena de Lomé s\'associent pour accueillir les phases finales des tournois majeurs, avec du matériel compétitif et une scène dédiée.',
  },
  {
    title: 'Free Fire Togo Series : 48 joueurs déjà inscrits',
    category: 'Free Fire',
    body: 'La Free Fire Togo Series affiche complet côté poules : 48 joueurs venus de Lomé, Kara et Sokodé s\'affrontent pour une place en finale nationale.',
  },
];

@Injectable()
export class NewsService {
  constructor(private prisma: PrismaService) {}

  /** Articles publiés, pour le site public. */
  async listPublished() {
    const rows = await this.prisma.newsPost.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    return rows.map((n) => ({
      id: n.id, title: n.title, slug: n.slug, category: n.category,
      body: n.body, imageUrl: n.imageUrl || null,
      date: this.relativeDate(n.createdAt),
    }));
  }

  private relativeDate(d: Date) {
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'Aujourd\'hui';
    if (days === 1) return 'Hier';
    if (days < 30) return `Il y a ${days} jours`;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Articles de démonstration si la table est vide. */
  async seed() {
    const count = await this.prisma.newsPost.count();
    if (count > 0) return { seeded: false, count };
    for (const n of DEMO_NEWS) {
      await this.prisma.newsPost.create({
        data: {
          title: n.title, category: n.category, body: n.body, published: true,
          slug: n.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) + '-' + Math.random().toString(36).slice(2, 6),
        },
      });
    }
    return { seeded: true, count: DEMO_NEWS.length };
  }
}
