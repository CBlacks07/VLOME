-- Associations : un compte ASSOCIATION pilote son club (membres, profil, intégration sur son site).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ASSOCIATION';

ALTER TABLE "Club"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "website" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Les clubs existants restent validés ; leur adresse publique est dérivée du nom (+ fin d'identifiant pour l'unicité).
UPDATE "Club"
SET "slug" = trim(both '-' from lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || right("id", 4)
WHERE "slug" IS NULL;

CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");
CREATE UNIQUE INDEX "Club_ownerId_key" ON "Club"("ownerId");
ALTER TABLE "Club" ADD CONSTRAINT "Club_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Club demandé par un joueur : identifiant du club choisi dans la liste (le libellé reste dans clubRequested).
ALTER TABLE "User" ADD COLUMN "clubRequestedId" TEXT;
