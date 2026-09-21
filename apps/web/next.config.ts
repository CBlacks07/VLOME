import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Autorise l'accès au serveur de dev depuis d'autres appareils du réseau local
  // (téléphone, tablette). Ajoute ici l'IP de chaque appareil de test.
  allowedDevOrigins: ["192.168.1.119", "192.168.1.1"],
  // Racine du monorepo (évite l'inférence à cause des lockfiles multiples).
  turbopack: { root: path.join(__dirname, "..", "..") },
  async headers() {
    return [
      {
        // Le service worker ne doit jamais être mis en cache par le navigateur, sinon une mise à jour
        // du site pourrait mettre des jours à atteindre les utilisateurs déjà installés.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
