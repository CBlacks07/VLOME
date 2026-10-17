import { ROUTES, type RouteKey } from "./seo";

/* Le pied de page de l'application affiche déjà ces mêmes liens et la même accroche : ce bloc reste dans le HTML
 * (liens suivis par les robots, lecteurs d'écran) mais n'est plus affiché une seconde fois à l'écran. */
const SR_ONLY = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

/**
 * Liens ordinaires (<a href>) vers les pages importantes, affichés en bas de chaque page. La navigation de
 * l'application passe par des boutons (invisibles pour les robots) : sans ces liens, Google ne découvrirait
 * les pages que par le sitemap. Sert aussi de « plan du site » pour les visiteurs.
 */
export default function SeoLinks({ intro }: { intro?: string }) {
  const keys = Object.keys(ROUTES) as RouteKey[];
  return (
    <nav aria-label="Plan du site" style={SR_ONLY}>
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
