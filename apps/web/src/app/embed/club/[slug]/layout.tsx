import type { Metadata } from "next";

// Page faite pour être intégrée ailleurs : on ne l'indexe pas comme une page du site.
export const metadata: Metadata = { title: "Association — Miabe Esport", robots: { index: false, follow: false } };

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
