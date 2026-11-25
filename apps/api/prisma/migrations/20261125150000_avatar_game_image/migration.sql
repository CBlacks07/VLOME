-- Photo de profil des comptes et visuel des jeux du catalogue.
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "Game" ADD COLUMN "imageUrl" TEXT;
