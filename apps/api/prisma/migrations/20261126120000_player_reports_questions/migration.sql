-- Scores envoyés par les joueurs (avec litiges) et questions personnalisées à l'inscription.
ALTER TABLE "Tournament"
  ADD COLUMN "allowPlayerReports" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "questions" JSONB;
ALTER TABLE "Registration" ADD COLUMN "answers" JSONB;

CREATE TABLE "ScoreReport" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "matchKey" TEXT NOT NULL,
  "aName" TEXT NOT NULL,
  "bName" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playerName" TEXT NOT NULL,
  "scoreA" INTEGER,
  "scoreB" INTEGER,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScoreReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScoreReport_match_user_key" ON "ScoreReport"("tournamentId", "matchKey", "aName", "bName", "userId");
CREATE INDEX "ScoreReport_tournamentId_status_idx" ON "ScoreReport"("tournamentId", "status");
ALTER TABLE "ScoreReport" ADD CONSTRAINT "ScoreReport_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
