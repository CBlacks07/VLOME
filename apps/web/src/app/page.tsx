import Spa from "./Spa";
import SeoLinks from "./SeoLinks";
import { ROUTES, SITE_URL, routeMetadata } from "./seo";
import { fetchBrand, absoluteMedia } from "./site-logo";

export const metadata = routeMetadata("accueil");

// Données structurées : disent à Google qui est ce site (organisation esport basée à Lomé) et le rattachent
// à son adresse officielle. N'affichent rien : elles servent aux résultats enrichis et au nom du site.
const buildJsonLd = (logo: string | null) => [
  {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: "Miabe Esport",
    alternateName: ["Miabe Esport Togo", "VLOME"],
    url: SITE_URL,
    ...(logo ? { logo } : {}),
    description: ROUTES.accueil.description,
    sport: "Esport",
    areaServed: { "@type": "Country", name: "Togo" },
    address: { "@type": "PostalAddress", addressLocality: "Lomé", addressCountry: "TG" },
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Miabe Esport",
    alternateName: "Miabe Esport Togo",
    url: SITE_URL,
    inLanguage: "fr",
  },
];

export default async function Home() {
  const JSON_LD = buildJsonLd(absoluteMedia((await fetchBrand()).logoUrl));
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <Spa initialPage="accueil" />
      <SeoLinks intro="Miabe Esport organise des tournois esport à Lomé et partout au Togo, avec inscriptions en ligne, classements des joueurs et des clubs, galerie et boutique gaming." />
    </>
  );
}
