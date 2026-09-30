-- CreateEnum
CREATE TYPE "TournamentTier" AS ENUM ('AMATEUR', 'ELITE');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN "tier" "TournamentTier" NOT NULL DEFAULT 'AMATEUR';
