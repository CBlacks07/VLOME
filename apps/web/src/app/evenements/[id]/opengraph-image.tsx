import { ImageResponse } from "next/og";
import { absoluteMedia, fetchBrand, fetchLogoDataUri } from "../../site-logo";
import { fetchEvent } from "../../seo";

// Aperçu de partage d'un événement sans affiche : nom, accroche, dates, lieu, nombre de tournois.
export const alt = "Événement esport — Miabe Esport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const frDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: e } = await fetchEvent(id);
  const logoUrl = absoluteMedia((await fetchBrand()).logoUrl);
  const logo = logoUrl ? await fetchLogoDataUri(logoUrl) : null;
  const when = e?.startDate ? `${frDate(e.startDate)}${e.endDate && e.endDate.slice(0, 10) !== e.startDate.slice(0, 10) ? ` → ${frDate(e.endDate)}` : ""}` : "";
  const facts = [
    when ? { k: "DATES", v: when } : null,
    e?.place ? { k: "LIEU", v: e.place } : null,
    e?.tournamentCount ? { k: "TOURNOIS", v: String(e.tournamentCount) } : null,
  ].filter(Boolean) as { k: string; v: string }[];
  const name = (e?.name || "Événement esport").slice(0, 70);
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
          <div style={{ display: "flex", fontSize: 24, fontWeight: 800, letterSpacing: 2, color: "#04222a", background: e?.state === "live" ? "#22D3EE" : "#7C82FF", borderRadius: 99, padding: "10px 24px" }}>{e?.state === "live" ? "EN DIRECT" : "ÉVÉNEMENT"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: name.length > 34 ? 64 : 84, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>{name}</div>
          {e?.tagline ? <div style={{ display: "flex", fontSize: 32, color: "#A6A8BC", marginTop: 20 }}>{e.tagline.slice(0, 110)}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          {facts.map((f) => (
            <div key={f.k} style={{ display: "flex", flexDirection: "column", background: "rgba(255,255,255,.05)", border: "1px solid #282838", borderRadius: 16, padding: "14px 22px" }}>
              <div style={{ display: "flex", fontSize: 18, letterSpacing: 2, color: "#8E8FA6", fontWeight: 700 }}>{f.k}</div>
              <div style={{ display: "flex", fontSize: 30, fontWeight: 800, marginTop: 4 }}>{f.v.slice(0, 40)}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
