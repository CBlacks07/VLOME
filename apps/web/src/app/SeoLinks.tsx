import { ROUTES, type RouteKey } from "./seo";

/**
 * Liens ordinaires (<a href>) vers les pages importantes, affichés en bas de chaque page. La navigation de
 * l'application passe par des boutons (invisibles pour les robots) : sans ces liens, Google ne découvrirait
 * les pages que par le sitemap. Sert aussi de « plan du site » pour les visiteurs.
 */
export default function SeoLinks({ intro }: { intro?: string }) {
  const keys = Object.keys(ROUTES) as RouteKey[];
  return (
    <nav aria-label="Plan du site" style={{ background: "#0B0B11", borderTop: "1px solid #1B1B27", padding: "22px 20px 28px", textAlign: "center", fontFamily: "Inter, system-ui, sans-serif" }}>
      {intro ? <p style={{ maxWidth: 720, margin: "0 auto 14px", color: "#5D5E72", fontSize: 12.5, lineHeight: 1.7 }}>{intro}</p> : null}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "8px 18px", justifyContent: "center" }}>
        {keys.map((k) => (
          <li key={k}>
            <a href={ROUTES[k].path} style={{ color: "#8E8FA6", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>
              {ROUTES[k].label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
