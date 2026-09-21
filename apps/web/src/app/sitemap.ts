import type { MetadataRoute } from "next";
import { ROUTES, SITE_URL, fetchPublicEvents, fetchPublicTournaments, type RouteKey } from "./seo";

// Régénéré toutes les heures : les nouveaux tournois y apparaissent sans redéployer le site.
export const revalidate = 3600;

/**
 * Pages à faire indexer : l'accueil, les grandes sections (adresses réelles, pas des #ancres que Google
 * ignore) et une page par tournoi publié. Les pages privées (profil, connexion, régie, admin) n'y sont
 * volontairement pas.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = (Object.keys(ROUTES) as RouteKey[]).map((k) => ({
    url: SITE_URL + (ROUTES[k].path === "/" ? "" : ROUTES[k].path),
    lastModified: now,
    changeFrequency: ROUTES[k].changeFrequency,
    priority: ROUTES[k].priority,
  }));
  const [tournaments, events] = await Promise.all([fetchPublicTournaments(), fetchPublicEvents()]);
  const eventPages: MetadataRoute.Sitemap = events.map((e) => ({
    url: `${SITE_URL}/evenements/${e.id}`,
    lastModified: now,
    changeFrequency: e.state === "ended" ? "monthly" : "daily",
    priority: e.state === "ended" ? 0.5 : 0.8,
  }));
  const tournamentPages: MetadataRoute.Sitemap = tournaments.map((t) => ({
    url: `${SITE_URL}/tournois/${t.id}`,
    lastModified: now,
    changeFrequency: t.status === "Terminé" ? "monthly" : "daily",
    priority: t.status === "Terminé" ? 0.4 : 0.7,
  }));
  return [...pages, ...eventPages, ...tournamentPages];
}
