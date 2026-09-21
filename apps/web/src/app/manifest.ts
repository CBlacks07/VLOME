import type { MetadataRoute } from "next";
import { fetchBrand, logoVersion } from "./site-logo";

// Manifeste de l'application installable (PWA). Next l'expose sur /manifest.webmanifest et l'ajoute
// automatiquement au <head>. Les icônes sont générées à partir du logo défini dans l'admin
// (voir /pwa-icon) ; le paramètre v change avec le logo pour que les appareils rechargent l'icône.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const brand = await fetchBrand();
  const v = logoVersion(brand.logoUrl);
  return {
    id: "/",
    name: "Miabe Esport",
    short_name: "Miabe Esport",
    description: "Compétitions, classements, communauté et boutique — le hub de l'esport togolais.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0B0B11",
    theme_color: "#0B0B11",
    categories: ["games", "sports", "entertainment"],
    icons: [
      { src: `/pwa-icon/192?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/pwa-icon/512?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/pwa-icon/maskable?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
