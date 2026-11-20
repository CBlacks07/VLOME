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

// La base (Neon) se met en veille quand elle est inactive : à la 1re connexion d'un build, elle peut mettre plusieurs secondes à se
// réveiller et « prisma migrate deploy » échoue alors par délai dépassé (P1002, verrou consultatif) alors que la base va très bien.
// On réessaie donc quelques fois, avec une pause, avant d'abandonner — si tous les essais échouent, le build échoue quand même
// (on ne déploie jamais une API sur une base dont les migrations n'ont pas pu être vérifiées).
const MAX_ATTEMPTS = 4;
const PAUSE_MS = 8000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    execSync('prisma migrate deploy && prisma generate', { stdio: 'inherit' });
    break;
  } catch (err) {
    if (attempt === MAX_ATTEMPTS) throw err;
    console.log(`[@vlome/api] prisma migrate deploy a échoué (essai ${attempt}/${MAX_ATTEMPTS}) — la base est peut-être en train de se réveiller ; nouvel essai dans ${PAUSE_MS / 1000} s…`);
    sleep(PAUSE_MS);
  }
}
