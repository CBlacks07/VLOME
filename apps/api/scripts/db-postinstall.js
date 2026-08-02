// Applique les migrations Prisma en attente puis régénère le client — seulement
// si DATABASE_URL est disponible. Ce script tourne dans le "postinstall" de
// @vlome/api, déclenché par TOUT `pnpm install` du monorepo (ex : build du
// projet web sur Vercel, qui n'a pas besoin de DATABASE_URL). Sans cette garde,
// un déploiement web casse l'installation partagée de tout le monorepo.
const { execSync } = require('child_process');

if (!process.env.DATABASE_URL) {
  console.log('[@vlome/api] DATABASE_URL absent — installation partagée du monorepo (probablement un autre projet) : on saute "prisma migrate deploy" + "prisma generate".');
  process.exit(0);
}

execSync('prisma migrate deploy && prisma generate', { stdio: 'inherit' });
