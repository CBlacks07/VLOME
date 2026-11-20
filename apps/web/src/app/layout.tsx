import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import PwaSetup from "./pwa";
import { fetchBrand, logoVersion } from "./site-logo";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.miabe-esport.community";
const TITLE = "Miabe Esport — Le hub de l'esport togolais";
const DESCRIPTION =
  "Compétitions, classements, communauté et boutique — la plateforme de référence de l'esport au Togo et en Afrique de l'Ouest.";

export async function generateMetadata(): Promise<Metadata> {
  // Icône d'onglet et d'écran d'accueil = logo défini dans l'admin (voir /pwa-icon), jamais un fichier livré.
  const v = logoVersion((await fetchBrand()).logoUrl);
  return {
  // metadataBase rend absolues les URL d'image et canonique : sans lui, l'aperçu de partage
  // (WhatsApp, Facebook…) reçoit un chemin relatif et n'affiche aucune image.
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Miabe Esport",
    locale: "fr_FR",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  // iOS : icône d'écran d'accueil + affichage plein écran une fois ajouté à l'écran d'accueil.
  icons: { icon: [{ url: `/pwa-icon/192?v=${v}`, sizes: "192x192", type: "image/png" }], apple: `/pwa-icon/180?v=${v}` },
  appleWebApp: { capable: true, title: "Miabe Esport", statusBarStyle: "black-translucent" },
  applicationName: "Miabe Esport",
  };
}

// Couleur de la barre d'état / de la fenêtre de l'application installée.
export const viewport: Viewport = {
  themeColor: "#0B0B11",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {/* Sombre par défaut : ce script pose le thème clair AVANT le premier rendu si l'utilisateur l'a choisi
            la dernière fois, pour éviter un flash sombre→clair. Rien à faire si le choix est sombre (ou absent) :
            c'est déjà la valeur par défaut des variables CSS (voir globals.css). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("vlome_theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <PwaSetup />
        {/* Statistiques de fréquentation Vercel (sans cookie) : visites et pages vues, visibles dans l'onglet Analytics du projet. */}
        <Analytics />
      </body>
    </html>
  );
}
