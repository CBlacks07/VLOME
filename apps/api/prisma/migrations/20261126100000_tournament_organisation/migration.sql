-- Organisation d'un tournoi : co-administrateurs, heure prévue par match, annonces et journal des actions.
ALTER TABLE "Tournament"
  ADD COLUMN "coAdminIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "matchPlans" JSONB,
  ADD COLUMN "announcements" JSONB,
  ADD COLUMN "activity" JSONB;
