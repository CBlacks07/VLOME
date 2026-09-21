import type { Metadata } from "next";

/** Adresse canonique du site (avec www) — celle que le sitemap, les balises canonical et les données structurées annoncent. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.miabe-esport.community").replace(/\/$/, "");
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Expressions que les gens tapent dans Google pour trouver ce genre de site. Elles alimentent les titres,
 * descriptions, mots-clés et textes des pages ci-dessous (Google se base surtout sur le contenu visible :
 * ces mots doivent réellement apparaître dans les titres et descriptions des pages).
 */
export const SEARCH_TERMS = [
  "Miabe Esport",
  "esport Togo",
  "tournoi esport Togo",
  "tournoi esport Lomé",
  "tournoi FIFA Lomé",
  "tournoi eFootball Togo",
  "tournoi EA FC 26 Togo",
  "compétition jeux vidéo Togo",
  "classement esport Togo",
  "gaming Lomé",
  "boutique gaming Lomé",
  "esport Afrique de l'Ouest",
  "organiser un tournoi esport",
  "inscription tournoi esport Togo",
];

export type RouteKey = "accueil" | "tournois" | "classements" | "galerie" | "boutique" | "mentions-legales" | "confidentialite";

export const ROUTES: Record<RouteKey, { path: string; label: string; title: string; description: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }> = {
  accueil: {
    path: "/",
    label: "Accueil",
    title: "Miabe Esport — Tournois esport au Togo (Lomé) : eFootball, EA FC, FIFA",
    description:
      "Miabe Esport, le hub de l'esport au Togo : tournois à Lomé (eFootball, EA FC, FIFA…), inscriptions en ligne, classements des joueurs et des clubs, galerie et boutique gaming.",
    priority: 1,
    changeFrequency: "daily",
  },
  tournois: {
    path: "/tournois",
    label: "Tournois",
    title: "Tournois esport à Lomé et au Togo — inscriptions ouvertes | Miabe Esport",
    description:
      "Tous les tournois esport au Togo : eFootball, EA FC, FIFA, Naruto… Dates, lieux, cagnottes et inscription en ligne pour participer à un tournoi gaming à Lomé.",
    priority: 0.9,
    changeFrequency: "daily",
  },
  classements: {
    path: "/classements",
    label: "Classements",
    title: "Classement esport Togo — meilleurs joueurs et clubs | Miabe Esport",
    description:
      "Le classement des meilleurs joueurs et des meilleurs clubs esport du Togo, mis à jour après chaque tournoi Miabe Esport : points, victoires et titres.",
    priority: 0.8,
    changeFrequency: "daily",
  },
  galerie: {
    path: "/galerie",
    label: "Galerie",
    title: "Galerie photos et vidéos des tournois esport au Togo | Miabe Esport",
    description:
      "Photos et vidéos des tournois esport organisés à Lomé et au Togo : finales, ambiance, podiums et moments forts de la communauté Miabe Esport.",
    priority: 0.6,
    changeFrequency: "weekly",
  },
  boutique: {
    path: "/boutique",
    label: "Boutique",
    title: "Boutique gaming à Lomé — maillots et accessoires Miabe Esport",
    description:
      "La boutique officielle Miabe Esport : maillots, casquettes et accessoires gaming, à commander en ligne et à récupérer à Lomé.",
    priority: 0.6,
    changeFrequency: "weekly",
  },
  "mentions-legales": {
    path: "/mentions-legales",
    label: "Mentions légales",
    title: "Mentions légales | Miabe Esport",
    description: "Mentions légales du site Miabe Esport.",
    priority: 0.2,
    changeFrequency: "yearly",
  },
  confidentialite: {
    path: "/confidentialite",
    label: "Confidentialité",
    title: "Politique de confidentialité | Miabe Esport",
    description: "Politique de confidentialité et protection des données du site Miabe Esport.",
    priority: 0.2,
    changeFrequency: "yearly",
  },
};

/** Métadonnées d'une route publique : titre, description, adresse canonique et aperçu de partage. */
export function routeMetadata(key: RouteKey): Metadata {
  const r = ROUTES[key];
  return {
    title: r.title,
    description: r.description,
    keywords: SEARCH_TERMS,
    alternates: { canonical: r.path },
    openGraph: { type: "website", siteName: "Miabe Esport", locale: "fr_FR", url: SITE_URL + r.path, title: r.title, description: r.description },
    twitter: { card: "summary_large_image", title: r.title, description: r.description },
  };
}

/** « 09 août 2026 » → « 2026-08-09 » (null si le format n'est pas reconnu) — pour les données structurées. */
export function frenchDateToIso(text?: string | null): string | null {
  if (!text) return null;
  const months = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
  const m = text.trim().toLowerCase().match(/^(\d{1,2})\s+([a-zéûô]+)\.?\s*(\d{4})?$/);
  if (!m) return null;
  const idx = months.findIndex((x) => m[2].startsWith(x));
  if (idx < 0) return null;
  const year = m[3] ? Number(m[3]) : new Date().getFullYear();
  return `${year}-${String(idx + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export type PublicTournament = { id: string; name: string; game?: string; place?: string; date?: string; status?: string; players?: number; imageUrl?: string | null; champion?: string | null };

/** Liste publique des tournois (côté serveur, pour le sitemap). Silencieux si l'API est injoignable. */
export async function fetchPublicTournaments(): Promise<PublicTournament[]> {
  try {
    const r = await fetch(`${API_URL}/api/tournaments`, { next: { revalidate: 3600 } });
    if (!r.ok) return [];
    const list = await r.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function fetchTournament(id: string): Promise<{ found: boolean; data?: PublicTournament }> {
  try {
    const r = await fetch(`${API_URL}/api/tournaments/${encodeURIComponent(id)}/state`, { next: { revalidate: 600 } });
    if (r.status === 404) return { found: false };
    if (!r.ok) return { found: true };
    return { found: true, data: await r.json() };
  } catch {
    return { found: true };
  }
}
