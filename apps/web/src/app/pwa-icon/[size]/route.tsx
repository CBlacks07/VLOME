import { ImageResponse } from "next/og";
import { absoluteMedia, fetchBrand, fetchLogoDataUri } from "../../site-logo";

/**
 * Icônes de l'application (onglet, écran d'accueil, installation) générées à la volée à partir du logo
 * défini dans l'admin. /pwa-icon/48 · 180 · 192 · 512 · maskable.
 * - Logo au format PNG/JPEG/GIF : redessiné à la bonne taille sur un fond clair (les logos sont le plus souvent
 *   des tracés sombres ou colorés sur fond transparent : sur fond noir ils deviendraient illisibles).
 * - Autre format (WebP…) : redirection vers le logo tel quel, les navigateurs savent l'afficher.
 * - Aucun logo défini : pastille par défaut (dégradé + initiales), jamais une image livrée avec le code.
 */
const SPECS: Record<string, { px: number; pad: number }> = {
  "48": { px: 48, pad: 0.02 },
  "180": { px: 180, pad: 0.07 }, // un symbole détouré ne doit pas toucher les bords arrondis de l'icône
  "192": { px: 192, pad: 0.07 },
  "512": { px: 512, pad: 0.07 },
  // Zone de sécurité des icônes « maskable » : le système peut rogner jusqu'à ~20 % sur chaque bord.
  maskable: { px: 512, pad: 0.2 },
};

const LOGO_BG = "#F4F5FB";

const HEADERS = { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400" };

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const spec = SPECS[size];
  if (!spec) return new Response("Taille inconnue", { status: 404 });

  const { px, pad } = spec;
  const inner = Math.round(px * (1 - 2 * pad));
  const brand = await fetchBrand();
  const logoUrl = absoluteMedia(brand.logoUrl);

  if (logoUrl) {
    const dataUri = await fetchLogoDataUri(logoUrl);
    if (!dataUri) return Response.redirect(logoUrl, 302);
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: LOGO_BG }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUri} width={inner} height={inner} style={{ width: inner, height: inner, objectFit: "contain" }} alt="" />
        </div>
      ),
      { width: px, height: px, headers: HEADERS },
    );
  }

  const initials = ((brand.name1 || "Miabe Esport").match(/\b\p{L}/gu) || ["M"]).slice(0, 2).join("").toUpperCase();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0B11" }}>
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: inner, height: inner, borderRadius: Math.round(inner * 0.24),
            background: "linear-gradient(140deg,#22D3EE,#7C82FF)", color: "#04222a", fontSize: Math.round(inner * 0.42), fontWeight: 800, fontFamily: "sans-serif",
          }}
        >
          {initials}
        </div>
      </div>
    ),
    { width: px, height: px, headers: HEADERS },
  );
}
