import { ImageResponse } from "next/og";

// Aperçu affiché quand un lien du site est partagé (WhatsApp, Facebook, X…).
// Généré ici plutôt que servi comme fichier : pas d'image à maintenir, et le rendu
// reprend exactement les couleurs du site.
export const alt = "Miabe Esport — le hub de l'esport togolais et ouest-africain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          background: "linear-gradient(135deg, #0B0B11 0%, #14141D 55%, #0E1A22 100%)",
          color: "#F4F5FB",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 34 }}>
          <div
            style={{
              display: "flex",
              width: 54,
              height: 54,
              borderRadius: 16,
              background: "linear-gradient(140deg,#22D3EE,#7C82FF)",
            }}
          />
          {/* Satori impose display:flex dès qu'un élément a plusieurs enfants. */}
          <div style={{ display: "flex", gap: 12, fontSize: 34, fontWeight: 800, letterSpacing: 4 }}>
            <span style={{ color: "#8E8FA6" }}>Miabe</span>
            <span style={{ color: "#22D3EE" }}>ESPORT</span>
          </div>
        </div>
        <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.06, letterSpacing: -1 }}>
          Le hub de l&apos;esport
        </div>
        <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.06, letterSpacing: -1, color: "#22D3EE" }}>
          togolais &amp; ouest-africain
        </div>
        <div style={{ fontSize: 30, color: "#8E8FA6", marginTop: 30 }}>
          Tournois · Classements · Communauté · Boutique
        </div>
      </div>
    ),
    { ...size },
  );
}
