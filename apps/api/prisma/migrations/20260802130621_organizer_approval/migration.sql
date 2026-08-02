-- CreateEnum
CREATE TYPE "OrganizerStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizerMaxPlayers" INTEGER,
ADD COLUMN     "organizerMaxTournaments" INTEGER,
ADD COLUMN     "organizerNote" TEXT,
ADD COLUMN     "organizerReviewedAt" TIMESTAMP(3),
ADD COLUMN     "organizerStatus" "OrganizerStatus" NOT NULL DEFAULT 'NONE';
