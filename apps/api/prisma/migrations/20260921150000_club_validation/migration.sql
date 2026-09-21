-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clubBlocking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clubRequested" TEXT,
ADD COLUMN     "clubReviewedAt" TIMESTAMP(3),
ADD COLUMN     "clubStatus" TEXT NOT NULL DEFAULT 'NONE';
