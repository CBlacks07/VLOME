# VLOME Esport Platform — Plan & Architecture

> Hub de l'esport togolais / Afrique de l'Ouest. Remplace www.vicenterlome.com.
> Document de cadrage : roadmap par phases, architecture, réutilisation de l'existant.

---

## 1. Principe directeur

On ne jette rien : l'app **Survival Challonge** déjà construite (moteur de tournoi testé :
poules, repêchage, bracket, scores, cagnotte, ELO, clubs, classements, mode Show, affiche)
devient le **cœur du Module Tournois** de la plateforme. On la fera évoluer d'un stockage
local (localStorage) vers l'API serveur, sans réécrire la logique.

Le reste de la plateforme (vitrine, actus, forum, boutique, comptes, paiements) est **nouveau**
et nécessite un vrai backend.

---

## 2. Architecture cible

```
┌───────────────────────────────────────────────────────────┐
│  FRONTEND  — Next.js (React + TypeScript) + Tailwind CSS   │
│  SSR/SSG pour le SEO · PWA · i18n (FR/EN)                  │
└───────────────┬───────────────────────────────────────────┘
                │ REST + WebSocket (temps réel : brackets, scores live)
┌───────────────┴───────────────────────────────────────────┐
│  BACKEND  — NestJS (TypeScript)                            │
│  Auth (OAuth + 2FA, Argon2) · Tournois · Boutique · Forum  │
│  Actus (CMS) · Paiements · Notifications · Admin           │
└───────┬───────────────────────┬───────────────────────────┘
        │                       │
   PostgreSQL              Redis (cache, sessions, files WS)
        │                       
   Cloudflare R2 / S3 (médias, documents, images produits)
```

**Choix recommandé : NestJS** (plutôt que Laravel) pour rester en **TypeScript de bout en bout**
— on partage les types entre front et back, et le moteur de tournoi actuel (JS pur) se porte
quasi tel quel côté serveur.

**Hébergement** : Vercel (front) + un VPS/conteneur (back) sur OVH/DigitalOcean, PostgreSQL managé,
Cloudflare devant (CDN, WAF, anti-DDoS).

---

## 3. Modules fonctionnels

| Module | Contenu | État |
|---|---|---|
| **Vitrine** | Accueil (slider, tournois, classements, actus, partenaires, boutique), Qui sommes-nous | à créer |
| **Actualités** | CMS, catégories, commentaires, partage, tags, recherche, newsletter | à créer |
| **Calendrier** | Compétitions, LAN, événements, formations, inscriptions | à créer |
| **Tournois / Module Challonge** | Bracket simple, Double élim, Swiss, Round Robin, Poules, Groupes, Battle Royale, **Survival**, scores, arbitrage, historique | **cœur déjà fait (Survival + poules + bracket + scores)** — à compléter |
| **Comptes joueurs** | Profil, stats, badges, récompenses, historique, classement | partiel (profils/stats/ELO existants) |
| **Tableau de bord joueur** | Profil, inscriptions, paiements, certificats | à créer |
| **Classements** | Par jeu, pays, ville, équipe, université, âge, saison, région, Afrique, international | partiel (classement points/ELO existant) |
| **Forum** | Catégories, fils, marketplace, recrutement, équipes | à créer |
| **Boutique** | Produits, vêtements, goodies, billets, cartes cadeaux | à créer |
| **Paiements** | Flooz, Mixx by Yas, Visa/Mastercard, PayPal, Stripe, virement, manuel | à créer |
| **Administration** | Utilisateurs, actus, tournois, produits, paiements, sponsors, forum, stats | à créer |

---

## 4. Roadmap par phases

**Phase 0 — Cadrage & design** *(en cours)*
Ce document + maquettes des pages clés + identité visuelle. Décisions : stack, hébergeur,
passerelles de paiement (comptes Flooz/Mixx/Stripe à ouvrir côté VLOME).

**Phase 1 — Fondations** (~3-4 sem.)
Repo mono-dépôt (front Next.js + back NestJS + Postgres), auth (inscription, connexion,
OAuth Google, 2FA), design system Tailwind, layout + navigation, page Accueil + Qui sommes-nous.

**Phase 2 — Module Tournois** (~3-4 sem.)
Portage du moteur existant côté serveur, inscriptions en ligne, **formats supplémentaires**
(double élim, Swiss, Round Robin, groupes, Battle Royale), scores + arbitrage, brackets en
**temps réel** (WebSocket), historique. Réutilise le mode Show et l'affiche déjà faits.

**Phase 3 — Communauté** (~3-4 sem.)
Comptes joueurs complets (badges, récompenses, certificats), classements multi-critères,
actualités (CMS + commentaires + newsletter), calendrier.

**Phase 4 — Boutique & paiements** (~3-4 sem.)
Catalogue, panier, commandes, intégration **Flooz / Mixx by Yas** (mobile money Togo) +
Stripe/PayPal, billets & cartes cadeaux, gestion des stocks.

**Phase 5 — Forum & finitions** (~2-3 sem.)
Forum, modération, tableau de bord admin global, SEO, PWA, perfs (< 2 s), sécurité (WAF,
sauvegardes), tests de charge.

> Estimation indicative : **~4 à 5 mois** pour une v1 complète, à ajuster selon l'équipe.

---

## 5. Prérequis à réunir (côté VLOME)

- Nom de domaine + hébergement (ou budget cloud).
- Comptes passerelles de paiement : **Flooz**, **Mixx by Yas**, Stripe/PayPal.
- Identité : logo VLOME, chartes couleurs, photos, textes (historique, mission, bureau).
- Contenus de départ : premières actualités, produits boutique, partenaires/sponsors.

---

## 6. Technologies proposées (résumé + avantages)

| Couche | Techno | Description | Avantage |
|---|---|---|---|
| Frontend | **Next.js (React + TS)** | Site rendu côté serveur (SSR/SSG) | SEO fort, rapide (< 2 s), PWA, une seule base de code web/mobile |
| Style | **Tailwind CSS** | Framework CSS utilitaire | Design cohérent et rapide, responsive natif |
| Backend | **NestJS (TS)** | API structurée (REST + WebSocket) | Tout en TypeScript → types partagés ; le moteur de tournoi actuel se porte quasi tel quel |
| Base de données | **PostgreSQL** | Base relationnelle | Robuste, gratuite, standard, gère bien classements/stats |
| Cache / temps réel | **Redis + Socket.io** | Cache + files temps réel | Brackets et scores **en direct**, sessions rapides |
| Stockage médias | **Cloudflare R2 / S3** | Fichiers (images, docs) | Pas cher, CDN intégré |
| Réseau / sécurité | **Cloudflare** | CDN + WAF + anti-DDoS | Gratuit au départ, protège et accélère |
| Auth | **OAuth + 2FA (Argon2)** | Connexion Google + double facteur | Sécurisé, standard |
| Paiements | **Agrégateur africain** (CinetPay / PayDunya) | Regroupe Flooz, Mixx by Yas, cartes | Une seule intégration pour tout le mobile money togolais + cartes |

> Recommandation : **NestJS** plutôt que Laravel (TypeScript de bout en bout, réutilise l'existant).
> Pour les paiements au Togo, un **agrégateur** (CinetPay/PayDunya/Semoa) est plus réaliste que
> Stripe/PayPal en direct : il couvre **Flooz + Mixx by Yas + Visa/Mastercard** d'un coup.

## 7. Coûts estimés (FCFA)

> Repères : 1 € = 655,957 FCFA (parité fixe) · 1 $ ≈ 610 FCFA. Estimations indicatives 2026,
> à affiner selon volume et prestataires.

### a) Développement (une fois)

| Scénario | Coût estimé | Note |
|---|---|---|
| **Développé avec moi (Claude Code)** | ~**12 000 – 60 000 FCFA / mois** | Uniquement l'abonnement IA ; main-d'œuvre ≈ 0, mais demande ton temps de suivi |
| Freelance(s) local(aux) | ~**1 500 000 – 3 000 000 FCFA** | 1–2 devs sur ~4-5 mois |
| Studio / agence | ~**4 000 000 – 9 000 000 FCFA** | Clé en main, gestion de projet incluse |

### b) Production — coûts récurrents

| Poste | Démarrage (lean) | Confort / montée en charge |
|---|---|---|
| Nom de domaine | ~12 000 FCFA / an | idem |
| Hébergement front (Vercel) | 0 (offre gratuite) | ~12 000 FCFA / mois (Pro) |
| Serveur back (VPS 2→8 Go) | ~5 000 – 8 000 FCFA / mois | ~15 000 – 30 000 FCFA / mois |
| PostgreSQL | 0 (sur le VPS) | ~9 000 – 15 000 FCFA / mois (managé) |
| Redis | 0 (sur le VPS) | ~6 000 – 10 000 FCFA / mois |
| Cloudflare (CDN/WAF) | 0 (gratuit) | ~12 000 FCFA / mois (Pro) |
| Stockage médias (R2/S3) | ~0 – 3 000 FCFA / mois | ~5 000 – 10 000 FCFA / mois |
| Emails (newsletter/transac.) | 0 (offre gratuite) | ~9 000 – 15 000 FCFA / mois |
| **Total** | **~8 000 – 15 000 FCFA / mois** | **~70 000 – 110 000 FCFA / mois** |

> Soit **~100 000 – 180 000 FCFA / an** au lancement, montant à **~850 000 – 1 300 000 FCFA / an**
> avec du trafic et les offres « Pro ».

### c) Frais par transaction (boutique / billets)

| Moyen | Commission approx. |
|---|---|
| Flooz / Mixx by Yas (via agrégateur) | ~1,5 – 3 % par paiement |
| Cartes Visa/Mastercard (agrégateur) | ~2,5 – 3,5 % |
| Stripe / PayPal (si applicable) | ~2,9 – 3,9 % + frais fixe |

> Les agrégateurs facturent au pourcentage (pas d'abonnement) ; parfois de petits frais
> d'activation. À négocier selon le volume.

## 8. Prochaine étape immédiate

Valider les **maquettes** (`maquette.html`) : Accueil, Tournois, Boutique, Profil, Classements.
Une fois la direction visuelle validée, on démarre la **Phase 1** (fondations).
