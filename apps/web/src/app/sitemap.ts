import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.miabe-esport.community";

// Le site est une application d'une seule page : les sections (tournois, galerie…) vivent dans le
// fragment d'URL (#tournois), que les moteurs de recherche n'indexent pas comme des pages
// distinctes. Déclarer la racine est donc la seule entrée honnête ici.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1 }];
}
