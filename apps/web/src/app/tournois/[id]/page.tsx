import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Spa from "../../Spa";
import SeoLinks from "../../SeoLinks";
import { SITE_URL, SEARCH_TERMS, fetchTournament, frenchDateToIso, playerCount } from "../../seo";

type Props = { params: Promise<{ id: string }> };

const STATUS_LABEL: Record<string, string> = { setup: "inscriptions ouvertes", live: "en direct", finished: "terminé" };

function pageTitle(t: { name?: string; game?: string; place?: string }) {
  const where = t.place ? ` à ${t.place}` : "";
  return `${t.name ?? "Tournoi"} — tournoi ${t.game ?? "esport"}${where} | Miabe Esport`;
}

function pageDescription(t: { name?: string; game?: string; place?: string; date?: string; players?: number | unknown[]; status?: string; champion?: string | null; prize?: string | null; entryFeeXof?: number }) {
  const bits = [
    `${t.name ?? "Tournoi"} : tournoi ${t.game ?? "esport"}`,
    t.place ? `à ${t.place} (Togo)` : "au Togo",
    t.date ? `le ${t.date}` : "",
  ].filter(Boolean).join(" ");
  const extra = [
    playerCount(t) !== undefined ? `${playerCount(t)} joueur${(playerCount(t) as number) > 1 ? "s" : ""} inscrit${(playerCount(t) as number) > 1 ? "s" : ""}` : "",
    t.status ? STATUS_LABEL[t.status] ?? "" : "",
    t.champion ? `champion : ${t.champion}` : "",
    t.prize ? `à gagner : ${t.prize}` : "",
    typeof t.entryFeeXof === "number" ? (t.entryFeeXof > 0 ? `inscription ${t.entryFeeXof.toLocaleString("fr-FR")} F` : "inscription gratuite") : "",
  ].filter(Boolean).join(", ");
  return `${bits}.${extra ? ` ${extra[0].toUpperCase()}${extra.slice(1)}.` : ""} Inscription et résultats sur Miabe Esport.`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { found, data } = await fetchTournament(id);
  if (!found) return { title: "Tournoi introuvable | Miabe Esport", robots: { index: false } };
  const title = data ? pageTitle(data) : "Tournoi esport | Miabe Esport";
  const description = data ? pageDescription(data) : "Détails, inscription et résultats de ce tournoi esport au Togo.";
  const url = `${SITE_URL}/tournois/${id}`;
  return {
    title,
    description,
    keywords: SEARCH_TERMS,
    alternates: { canonical: `/tournois/${id}` },
    openGraph: { type: "website", siteName: "Miabe Esport", locale: "fr_FR", url, title, description, ...(data?.imageUrl ? { images: [{ url: data.imageUrl }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(data?.imageUrl ? { images: [data.imageUrl] } : {}) },
  };
}

export default async function TournoiPage({ params }: Props) {
  const { id } = await params;
  const { found, data } = await fetchTournament(id);
  if (!found) notFound();

  const startDate = frenchDateToIso(data?.date);
  const jsonLd = data
    ? {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        name: data.name,
        description: pageDescription(data),
        url: `${SITE_URL}/tournois/${id}`,
        ...(startDate ? { startDate } : {}),
        ...(data.imageUrl ? { image: data.imageUrl } : {}),
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: { "@type": "Place", name: data.place || "Togo", address: { "@type": "PostalAddress", addressCountry: "TG" } },
        organizer: { "@type": "Organization", name: "Miabe Esport", url: SITE_URL },
        ...(data.game ? { about: data.game } : {}),
      }
    : null;

  return (
    <>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /> : null}
      <Spa initialPage="tournoi" initialOpenId={id} />
      <SeoLinks intro={data ? pageDescription(data) : undefined} />
    </>
  );
}
