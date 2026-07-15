import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Autorise l'accès au serveur de dev depuis d'autres appareils du réseau local
  // (téléphone, tablette). Ajoute ici l'IP de chaque appareil de test.
  allowedDevOrigins: ["192.168.1.119", "192.168.1.1"],
};

export default nextConfig;
