import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VLOME Esport — Le hub de l'esport togolais",
  description:
    "Compétitions, classements, communauté et boutique — la plateforme de référence de l'esport au Togo et en Afrique de l'Ouest.",
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
