import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Spa from "../../Spa";
import SeoLinks from "../../SeoLinks";
import { API_URL, SITE_URL, SEARCH_TERMS, fetchEvent, type PublicEvent } from "../../seo";

type Props = { params: Promise<{ id: string }> };

const mediaUrl = (u?: string | null) => (!u ? undefined : /^https?:\/\//.test(u) ? u : `${API_URL}${u}`);
const isVideo = (u?: string | null) => !!u && /\.(mp4|webm)(\?|$)/i.test(u);

function frDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
}

function pageTitle(e: PublicEvent) {
  return `${e.name}${e.place ? ` à ${e.place}` : ""} — événement esport | Miabe Esport`;
}

function pageDescription(e: PublicEvent) {
  const when = e.startDate ? `Du ${frDate(e.startDate)}${e.endDate && e.endDate.slice(0, 10) !== e.startDate.slice(0, 10) ? ` au ${frDate(e.endDate)}` : ""}` : "";
  const bits = [e.tagline, [when, e.place].filter(Boolean).join(" · "), e.tournamentCount ? `${e.tournamentCount} tournoi${e.tournamentCount > 1 ? "s" : ""}` : ""].filter(Boolean);
  return `${e.name} : ${bits.join(". ")}. Programme, tournois et inscriptions sur Miabe Esport.`.slice(0, 300);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { found, data } = await fetchEvent(id);
  if (!found) return { title: "Événement introuvable | Miabe Esport", robots: { index: false } };
  const title = data ? pageTitle(data) : "Événement esport | Miabe Esport";
  const description = data ? pageDescription(data) : "Programme, tournois et inscriptions de cet événement esport au Togo.";
  const image = data ? mediaUrl(data.posterUrl) || (isVideo(data.bannerUrl) ? undefined : mediaUrl(data.bannerUrl)) : undefined;
  return {
    title,
    description,
    keywords: SEARCH_TERMS,
    alternates: { canonical: `/evenements/${id}` },
    openGraph: { type: "website", siteName: "Miabe Esport", locale: "fr_FR", url: `${SITE_URL}/evenements/${id}`, title, description, ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(image ? { images: [image] } : {}) },
  };
}

export default async function EventPage({ params }: Props) {
  const { id } = await params;
  const { found, data } = await fetchEvent(id);
  if (!found) notFound();

  const image = data ? mediaUrl(data.posterUrl) || (isVideo(data.bannerUrl) ? undefined : mediaUrl(data.bannerUrl)) : undefined;
  const jsonLd = data
    ? {
        "@context": "https://schema.org",
        "@type": "Event",
        name: data.name,
        description: pageDescription(data),
        url: `${SITE_URL}/evenements/${id}`,
        ...(data.startDate ? { startDate: data.startDate } : {}),
        ...(data.endDate ? { endDate: data.endDate } : {}),
        ...(image ? { image } : {}),
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: { "@type": "Place", name: data.place || "Togo", address: { "@type": "PostalAddress", addressCountry: "TG" } },
        organizer: { "@type": "Organization", name: "Miabe Esport", url: SITE_URL },
      }
    : null;

  return (
    <>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /> : null}
      <Spa initialPage="evenement" initialEventId={id} />
      <SeoLinks intro={data ? pageDescription(data) : undefined} />
    </>
  );
}
