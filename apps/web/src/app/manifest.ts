import type { MetadataRoute } from "next";

// Manifeste de l'application installable (PWA). Next l'expose sur /manifest.webmanifest et l'ajoute
// automatiquement au <head>. Les icônes sont dans /public (générées depuis le logo).
export default function manifest(): MetadataRoute.Manifest {
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
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
