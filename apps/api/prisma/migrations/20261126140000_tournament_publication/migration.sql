-- Statut de publication des tournois hors événement : brouillon (invisible), inscriptions ouvertes, inscriptions closes.
ALTER TABLE "Tournament" ADD COLUMN "publication" TEXT NOT NULL DEFAULT 'DRAFT';
-- Les tournois déjà en ligne le restent.
UPDATE "Tournament" SET "publication" = 'OPEN';
