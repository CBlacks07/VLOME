import Spa from "./Spa";
import SeoLinks from "./SeoLinks";
import { ROUTES, SITE_URL, routeMetadata } from "./seo";

export const metadata = routeMetadata("accueil");

// Données structurées : disent à Google qui est ce site (organisation esport basée à Lomé) et le rattachent
// à son adresse officielle. N'affichent rien : elles servent aux résultats enrichis et au nom du site.
const JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: "Miabe Esport",
    alternateName: ["Miabe Esport Togo", "VLOME"],
    url: SITE_URL,
    logo: `${SITE_URL}/icon-512.png`,
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

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <Spa initialPage="accueil" />
      <SeoLinks intro="Miabe Esport organise des tournois esport à Lomé et partout au Togo (eFootball, EA FC, FIFA…), avec inscriptions en ligne, classements des joueurs et des clubs, galerie et boutique gaming." />
    </>
  );
}
