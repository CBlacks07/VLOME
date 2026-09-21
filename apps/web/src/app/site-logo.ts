import { API_URL } from "./seo";

/**
 * Le logo du site vient TOUJOURS de l'admin (Site → Identité) : aucune image de logo n'est livrée avec le
 * code. Tout ce qui en a besoin côté serveur (icône d'onglet, icône d'application installée, aperçu de
 * partage, données structurées) passe par ce module, qui lit les réglages publics de l'API.
 */
export type Brand = { name1?: string; name2?: string; logoUrl?: string | null };

export async function fetchBrand(): Promise<Brand> {
  try {
    const r = await fetch(`${API_URL}/api/settings`, { next: { revalidate: 300 } });
    if (!r.ok) return {};
    const s = await r.json();
    return (s && s.brand) || {};
  } catch {
    return {};
  }
}

/** Les logos envoyés depuis l'admin sont soit des URL absolues (Cloudinary), soit un chemin servi par l'API. */
export function absoluteMedia(url?: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//.test(url) ? url : `${API_URL}${url}`;
}

/** Court identifiant du logo actuel : ajouté aux URL d'icônes pour que le navigateur les recharge quand l'admin change de logo. */
export function logoVersion(url?: string | null): string {
  let h = 5381;
  for (const c of url || "none") h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** Télécharge le logo et le renvoie en data-URI (PNG/JPEG/GIF, les formats que le générateur d'images sait dessiner) ; null sinon. */
export async function fetchLogoDataUri(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { next: { revalidate: 300 } });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/gif"].includes(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
