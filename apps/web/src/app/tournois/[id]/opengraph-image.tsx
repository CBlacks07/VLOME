import { ImageResponse } from "next/og";
import { absoluteMedia, fetchBrand, fetchLogoDataUri } from "../../site-logo";
import { fetchTournament, playerCount } from "../../seo";

// Aperçu de partage d'un tournoi (WhatsApp, Facebook, X…) quand il n'a pas d'affiche : nom, jeu, date, lieu,
// statut, participants, lot — le lien parle de lui-même sans avoir à l'ouvrir. Un tournoi AVEC affiche garde
// son affiche (voir generateMetadata dans page.tsx, qui prend le dessus).
export const alt = "Tournoi esport — Miabe Esport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STATUS: Record<string, { label: string; color: string }> = {
  setup: { label: "INSCRIPTIONS OUVERTES", color: "#34D399" },
  live: { label: "EN DIRECT", color: "#22D3EE" },
  finished: { label: "TERMINÉ", color: "#FBBF24" },
};

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: t } = await fetchTournament(id);
  const logoUrl = absoluteMedia((await fetchBrand()).logoUrl);
  const logo = logoUrl ? await fetchLogoDataUri(logoUrl) : null;
  const st = STATUS[t?.status || ""] || STATUS.setup;
  const facts = [
    t?.date ? { k: "DATE", v: t.date } : null,
    t?.place ? { k: "LIEU", v: t.place } : null,
    playerCount(t) !== undefined ? { k: t?.teamSize ? "ÉQUIPES" : "JOUEURS", v: String(playerCount(t)) } : null,
    t?.prize ? { k: "À GAGNER", v: t.prize } : t?.entryFeeXof ? { k: "INSCRIPTION", v: `${t.entryFeeXof.toLocaleString("fr-FR")} F` } : { k: "INSCRIPTION", v: "Gratuite" },
  ].filter(Boolean) as { k: string; v: string }[];
  const name = (t?.name || "Tournoi esport").slice(0, 80);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "56px 70px", background: "linear-gradient(135deg, #0B0B11 0%, #14141D 55%, #0E1A22 100%)", color: "#F4F5FB", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <div style={{ display: "flex", width: 64, height: 64, borderRadius: 16, background: "#F4F5FB", alignItems: "center", justifyContent: "center" }}>
                <img src={logo} width={56} height={56} style={{ width: 56, height: 56, objectFit: "contain" }} alt="" />
              </div>
            ) : (
              <div style={{ display: "flex", width: 44, height: 44, borderRadius: 12, background: "linear-gradient(140deg,#22D3EE,#7C82FF)" }} />
            )}
            <div style={{ display: "flex", gap: 10, fontSize: 28, fontWeight: 800, letterSpacing: 3 }}>
              <span style={{ color: "#8E8FA6" }}>Miabe</span>
              <span style={{ color: "#22D3EE" }}>ESPORT</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 800, letterSpacing: 2, color: "#04222a", background: st.color, borderRadius: 99, padding: "10px 24px" }}>{st.label}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          {t?.game ? <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#22D3EE", letterSpacing: 2, marginBottom: 14 }}>{t.game.toUpperCase()}</div> : null}
          <div style={{ display: "flex", fontSize: name.length > 40 ? 62 : 78, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>{name}</div>
          {t?.champion ? <div style={{ display: "flex", fontSize: 34, color: "#FBBF24", marginTop: 20 }}>Champion : {t.champion}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          {facts.map((f) => (
            <div key={f.k} style={{ display: "flex", flexDirection: "column", background: "rgba(255,255,255,.05)", border: "1px solid #282838", borderRadius: 16, padding: "14px 22px" }}>
              <div style={{ display: "flex", fontSize: 18, letterSpacing: 2, color: "#8E8FA6", fontWeight: 700 }}>{f.k}</div>
              <div style={{ display: "flex", fontSize: 30, fontWeight: 800, marginTop: 4 }}>{f.v.slice(0, 28)}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
