import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.miabe-esport.community";
const TITLE = "Miabe Esport — Le hub de l'esport togolais";
const DESCRIPTION =
  "Compétitions, classements, communauté et boutique — la plateforme de référence de l'esport au Togo et en Afrique de l'Ouest.";

export const metadata: Metadata = {
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
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
