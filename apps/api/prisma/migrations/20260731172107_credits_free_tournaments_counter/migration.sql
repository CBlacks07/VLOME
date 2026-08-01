-- AlterTable
ALTER TABLE "User" ADD COLUMN     "freeTournamentsUsed" INTEGER NOT NULL DEFAULT 0;

-- Reprend les valeurs déjà consommées (booléen -> compteur) avant de retirer l'ancienne colonne.
UPDATE "User" SET "freeTournamentsUsed" = 1 WHERE "freeTournamentUsed" = true;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "freeTournamentUsed";
