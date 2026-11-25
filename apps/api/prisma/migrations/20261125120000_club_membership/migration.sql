-- Adhésions joueur ↔ club : une seule source, avec statut et dates. Remplace les champs "clubRequested*" posés sur le compte
-- (conservés seulement pour retenir le club qu'un joueur attend encore sur la plateforme).
CREATE TABLE "ClubMembership" (
  "id" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "initiatedBy" TEXT NOT NULL DEFAULT 'player',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "ClubMembership_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClubMembership_clubId_status_idx" ON "ClubMembership"("clubId", "status");
CREATE INDEX "ClubMembership_playerId_status_idx" ON "ClubMembership"("playerId", "status");
-- Un joueur n'est membre actif que d'un seul club à la fois (garanti par la base, pas seulement par le code).
CREATE UNIQUE INDEX "ClubMembership_one_active_per_player" ON "ClubMembership"("playerId") WHERE "status" = 'active';
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubMembership" ADD CONSTRAINT "ClubMembership_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fiche de la base de joueurs qu'un compte demande à reprendre (même nom) : à valider par l'admin.
ALTER TABLE "Player" ADD COLUMN "claimUserId" TEXT;

-- Reprise de l'existant 1/3 : chaque joueur déjà dans un club en devient membre actif.
INSERT INTO "ClubMembership" ("id", "clubId", "playerId", "status", "initiatedBy", "createdAt", "decidedAt")
SELECT 'mig_a_' || p."id", p."clubId", p."id", 'active', 'admin', p."createdAt", CURRENT_TIMESTAMP
FROM "Player" p
WHERE p."clubId" IS NOT NULL;

-- 2/3 : un compte avec une demande en attente vers un club existant, mais sans fiche joueur, en reçoit une.
INSERT INTO "Player" ("id", "name", "city", "userId")
SELECT 'mig_p_' || u."id", u."displayName", u."city", u."id"
FROM "User" u
JOIN "Club" c ON c."id" = u."clubRequestedId"
WHERE u."clubStatus" = 'PENDING' AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p."userId" = u."id");

-- 3/3 : ces demandes deviennent des adhésions "requested"…
INSERT INTO "ClubMembership" ("id", "clubId", "playerId", "status", "initiatedBy", "createdAt")
SELECT 'mig_r_' || u."id", c."id", p."id", 'requested', 'player', u."createdAt"
FROM "User" u
JOIN "Club" c ON c."id" = u."clubRequestedId"
JOIN "Player" p ON p."userId" = u."id"
WHERE u."clubStatus" = 'PENDING' AND (p."clubId" IS NULL OR p."clubId" <> c."id");

-- …et les anciens champs du compte sont vidés (les demandes saisies à la main, sans identifiant de club, restent à traiter).
UPDATE "User" SET "clubStatus" = 'NONE', "clubRequested" = NULL, "clubRequestedId" = NULL, "clubBlocking" = false
WHERE "clubStatus" = 'PENDING' AND "clubRequestedId" IN (SELECT "id" FROM "Club");

-- Anciennes demandes saisies à la main : l'équipe ne valide plus de club. Le joueur attend que son club rejoigne la
-- plateforme ('WAITING' = pas encore prévenu) et son compte est débloqué.
UPDATE "User" SET "clubStatus" = 'WAITING', "clubRequestedId" = NULL
WHERE "clubStatus" = 'PENDING' AND "clubRequested" IS NOT NULL;
UPDATE "User" SET "clubBlocking" = false WHERE "clubBlocking" = true;
