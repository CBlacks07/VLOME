-- Matchs dont les joueurs ont été appelés : { clé du match : horodatage }.
ALTER TABLE "Tournament" ADD COLUMN "matchCalls" JSONB;
