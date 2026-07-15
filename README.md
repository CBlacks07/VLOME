# VLOME Esport Platform

Hub de l'esport togolais & ouest-africain. Monorepo pnpm.

## Stack
- **Web** : Next.js 16 (React 19 + TypeScript) + Tailwind CSS — `apps/web`
- **API** : NestJS (TypeScript) + Prisma — `apps/api`
- **Moteur de tournoi** : `@vlome/engine` (TypeScript pur, réutilisé web + API) — `packages/engine`
- **Base de données** : PostgreSQL · **Cache/temps réel** : Redis — `docker-compose.yml`
- **Paiements** (à intégrer) : agrégateur africain (CinetPay / PayDunya) → Flooz, Mixx by Yas, cartes

## Prérequis
- Node ≥ 20, pnpm, **PostgreSQL** (base `vlome`). Redis en option (temps réel, plus tard).

## Démarrer
```bash
pnpm install                 # installe tout le workspace

# Base : renseigner apps/api/.env avec ton DATABASE_URL Postgres (voir .env.example)
cd apps/api && npx prisma migrate dev   # applique le schéma à la base vlome
cd ../..

pnpm dev:api                 # http://localhost:4000/api/health
pnpm dev:web                 # http://localhost:3000
```
Amorcer des tournois de démo : `POST http://localhost:4000/api/tournaments/seed`.

> `apps/api/.env` (non committé) contient le `DATABASE_URL` Postgres.
> Sans Postgres local, tu peux pointer `DATABASE_URL` vers une base cloud (Neon/Supabase),
> ou lancer Postgres+Redis via `docker compose up -d`.

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
