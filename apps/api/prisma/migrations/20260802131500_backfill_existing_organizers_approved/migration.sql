-- Les comptes ORGANIZER déjà existants avant l'ajout de la validation admin restent
-- fonctionnels (pas de blocage rétroactif) — seules les nouvelles inscriptions partent
-- en PENDING (voir AuthService.register).
UPDATE "User" SET "organizerStatus" = 'APPROVED' WHERE "role" = 'ORGANIZER' AND "organizerStatus" = 'NONE';
