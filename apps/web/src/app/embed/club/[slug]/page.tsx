"use client";

/**
 * Page d'une association destinée à être affichée dans un <iframe> sur son propre site (voir « Intégration » dans
 * l'espace association) : tournois qu'elle organise, tournois où jouent ses membres, classement et liste des membres.
 * Autonome (aucun chrome du site), lecture seule, clair/sombre selon le visiteur ou `?theme=light|dark`.
 */
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type ClubData = {
  club: { name: string; slug: string; city: string | null; logoUrl: string | null; website: string | null; description: string | null };
  stats: { members: number; organized: number };
  members: { rank: number; avatarUrl?: string | null; name: string; city: string | null; points: number; wins: number; matches: number }[];
  tournaments: { id: string; name: string; game: string | null; status: string; date: string | null; place: string | null; imageUrl: string | null; organizedByClub: boolean }[];
};

const STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "À venir", color: "#7C82FF" },
  LIVE: { label: "En direct", color: "#22D3EE" },
  FINISHED: { label: "Terminé", color: "#34D399" },
};

function mediaUrl(u: string | null): string | null {
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `${API}${u.startsWith("/") ? "" : "/"}${u}`;
}

export default function ClubEmbed() {
  const { slug } = useParams<{ slug: string }>();
  const theme = useSearchParams().get("theme");
  const [data, setData] = useState<ClubData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"tournois" | "classement" | "membres">("tournois");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/public/clubs/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Association introuvable." : "Impossible de charger cette association.");
        return r.json();
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Erreur."); });
    return () => { cancelled = true; };
  }, [slug]);

  // Prévient la page hôte de la hauteur du contenu, pour que le script d'intégration ajuste l'iframe.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const send = () => { try { window.parent.postMessage({ miabeEmbed: "height", slug, height: Math.ceil(el.getBoundingClientRect().height) + 2 }, "*"); } catch { /* hors iframe */ } };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slug]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const dark = theme === "dark" || (theme !== "light" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const c = dark
    ? { bg: "#0B0B12", surface: "#14141E", border: "#262637", text: "#F2F2F8", muted: "#9A9AB0", faint: "#6B6B82" }
    : { bg: "#FFFFFF", surface: "#F5F6FA", border: "#E3E5EE", text: "#14141E", muted: "#55566A", faint: "#8A8CA0" };

  const wrap: React.CSSProperties = { background: c.bg, color: c.text, fontFamily: "Inter, system-ui, sans-serif", padding: 16, minHeight: 200 };
  const tabBtn = (k: typeof tab, label: string, n?: number) => (
    <button key={k} onClick={() => setTab(k)} style={{ flex: "none", padding: "9px 14px", borderRadius: 10, border: `1px solid ${tab === k ? "#22D3EE" : c.border}`, background: tab === k ? "rgba(34,211,238,.12)" : "transparent", color: tab === k ? "#0891b2" : c.muted, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
      {label}{n !== undefined ? ` · ${n}` : ""}
    </button>
  );

  if (error) return <div ref={root} style={wrap}><p style={{ color: c.muted, fontSize: 14 }}>{error}</p></div>;
  if (!data) return <div ref={root} style={wrap}><p style={{ color: c.muted, fontSize: 14 }}>Chargement…</p></div>;

  const { club, stats, members, tournaments } = data;
  const logo = mediaUrl(club.logoUrl);
  const card: React.CSSProperties = { background: c.surface, border: `1px solid ${c.border}`, borderRadius: 14 };

  return (
    <div ref={root} style={wrap}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" style={{ width: 52, height: 52, borderRadius: 14, objectFit: "cover", border: `1px solid ${c.border}` }} />
        ) : (
          <span style={{ display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,#22D3EE,#7C82FF)", color: "#04222a", fontWeight: 800, fontSize: 22 }}>{club.name.charAt(0).toUpperCase()}</span>
        )}
        <div style={{ flex: 1, minWidth: 180 }}>
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.15, letterSpacing: 0.3 }}>{club.name}</h1>
          <div style={{ color: c.muted, fontSize: 13, marginTop: 3 }}>
            {[club.city, `${stats.members} membre${stats.members > 1 ? "s" : ""}`, `${stats.organized} tournoi${stats.organized > 1 ? "s" : ""} organisé${stats.organized > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
            {club.website ? <> · <a href={club.website} target="_blank" rel="noopener noreferrer" style={{ color: "#0891b2" }}>Site web</a></> : null}
          </div>
        </div>
      </header>
      {club.description ? <p style={{ margin: "0 0 14px", color: c.muted, fontSize: 13.5, lineHeight: 1.6 }}>{club.description}</p> : null}

      <nav style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14 }}>
        {tabBtn("tournois", "Tournois", tournaments.length)}
        {tabBtn("classement", "Classement")}
        {tabBtn("membres", "Membres", members.length)}
      </nav>

      {tab === "tournois" && (
        tournaments.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12 }}>
            {tournaments.map((t) => {
              const st = STATUS[t.status] || STATUS.DRAFT;
              const img = mediaUrl(t.imageUrl);
              return (
                <a key={t.id} href={`${origin}/tournois/${t.id}`} target="_blank" rel="noopener noreferrer" style={{ ...card, display: "block", overflow: "hidden", textDecoration: "none", color: c.text }}>
                  <div style={{ height: 88, background: img ? `url(${img}) center/cover` : "linear-gradient(135deg,rgba(34,211,238,.25),rgba(124,130,255,.25))" }} />
                  <div style={{ padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: st.color }}>{st.label}</span>
                      {t.organizedByClub ? <span style={{ fontSize: 10.5, fontWeight: 700, color: c.faint }}>· organisé par le club</span> : null}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.3 }}>{t.name}</div>
                    <div style={{ color: c.muted, fontSize: 12.5, marginTop: 4 }}>
                      {[t.game, t.place, t.date ? new Date(t.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        ) : <p style={{ color: c.muted, fontSize: 14 }}>Aucun tournoi pour l&apos;instant.</p>
      )}

      {tab === "classement" && (
        members.length ? (
          <div style={{ ...card, overflow: "hidden" }}>
            {members.map((m) => (
              <div key={m.rank + m.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: m.rank === 1 ? "none" : `1px solid ${c.border}` }}>
                <span style={{ width: 26, textAlign: "right", color: m.rank <= 3 ? "#d99a00" : c.faint, fontWeight: 800 }}>{m.rank}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 650, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                <span style={{ color: c.faint, fontSize: 12 }}>{m.matches} match{m.matches > 1 ? "s" : ""}</span>
                <span style={{ fontWeight: 800, fontSize: 14, color: "#0891b2", minWidth: 64, textAlign: "right" }}>{m.points} pts</span>
              </div>
            ))}
          </div>
        ) : <p style={{ color: c.muted, fontSize: 14 }}>Pas encore de classement.</p>
      )}

      {tab === "membres" && (
        members.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {members.map((m) => (
              <span key={m.rank + m.name} style={{ display: "inline-flex", alignItems: "center", gap: 8, ...card, borderRadius: 999, padding: "6px 14px 6px 6px", fontSize: 13.5, fontWeight: 600 }}>
                {m.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(m.avatarUrl) as string} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
                ) : (
                  <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "50%", background: "rgba(34,211,238,.15)", color: "#0891b2", fontSize: 12, fontWeight: 800 }}>{m.name.charAt(0).toUpperCase()}</span>
                )}
                {m.name}{m.city ? <span style={{ color: c.faint, fontWeight: 500 }}> · {m.city}</span> : null}
              </span>
            ))}
          </div>
        ) : <p style={{ color: c.muted, fontSize: 14 }}>Aucun membre pour l&apos;instant.</p>
      )}

      <footer style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${c.border}`, fontSize: 11.5, color: c.faint }}>
        Propulsé par <a href={origin || "#"} target="_blank" rel="noopener noreferrer" style={{ color: "#0891b2", fontWeight: 700 }}>Miabe Esport</a>
      </footer>
    </div>
  );
}
