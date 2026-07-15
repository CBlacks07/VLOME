# VLOME Esport Platform

Hub de l'esport togolais & ouest-africain. Monorepo pnpm.

## Stack
- **Web** : Next.js 16 (React 19 + TypeScript) + Tailwind CSS — `apps/web`
- **API** : NestJS (TypeScript) + Prisma — `apps/api`
- **Moteur de tournoi** : `@vlome/engine` (TypeScript pur, réutilisé web + API) — `packages/engine`
- **Base de données** : PostgreSQL · **Cache/temps réel** : Redis — `docker-compose.yml`
- **Paiements** (à intégrer) : agrégateur africain (CinetPay / PayDunya) → Flooz, Mixx by Yas, cartes

## Prérequis
- Node ≥ 20, pnpm. **Aucun Docker requis en dev** (base SQLite locale).

## Démarrer (dev, sans infrastructure)
```bash
pnpm install                 # installe tout le workspace
pnpm dev:web                 # http://localhost:3000  (frontend, marche seul)
pnpm dev:api                 # http://localhost:4000/api/health
```
Base de données de dev (SQLite, fichier local — aucun serveur) :
```bash
cd apps/api && npx prisma migrate dev   # crée apps/api/dev.db  (déjà fait : init)
```
> Le fichier `apps/api/.env` contient `DATABASE_URL="file:./dev.db"`.

## Production (PostgreSQL + Redis)
```bash
docker compose up -d         # Postgres (5432) + Redis (6379)   ← ou une base cloud
# puis dans apps/api/.env : DATABASE_URL=postgresql://...
# et dans prisma/schema.prisma : provider = "postgresql" (+ enums/Json natifs)
pnpm --filter @vlome/api exec prisma migrate deploy
```

## Vérifier
- Web : http://localhost:3000 (accueil, tournois, classements, boutique, profil)
- API santé : http://localhost:4000/api/health
- API démo moteur : http://localhost:4000/api/engine/demo (simule un tournoi Survival côté serveur)

## Structure
```
VLOME/
  apps/
    web/        Next.js + Tailwind (interface, thème « Arène », icônes SVG)
    api/        NestJS + Prisma (schéma Postgres : users, players, clubs,
                tournaments, matches, news, products, orders)
  packages/
    engine/     @vlome/engine — moteur Survival (poules, repêchage, bracket,
                cagnotte, classements, ELO, clubs) porté en TypeScript
  docker-compose.yml   Postgres + Redis
  PLAN.md              Roadmap, architecture, coûts (FCFA)
  design-reference.html  Maquette statique de référence
```

## Feuille de route
Voir `PLAN.md`. État actuel : **Phase 1 amorcée** — monorepo + web (accueil VLOME) + API
(santé + démo moteur) + schéma DB. À suivre : auth, inscriptions, formats de tournoi
supplémentaires, temps réel (WebSocket), boutique + paiements, forum, admin.
