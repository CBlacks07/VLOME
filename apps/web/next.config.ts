import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Autorise l'accès au serveur de dev depuis d'autres appareils du réseau local
  // (téléphone, tablette). Ajoute ici l'IP de chaque appareil de test.
  allowedDevOrigins: ["192.168.1.119", "192.168.1.1"],
  // Racine du monorepo (évite l'inférence à cause des lockfiles multiples).
  turbopack: { root: path.join(__dirname, "..", "..") },
};

export default nextConfig;
