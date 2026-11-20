-- Commandes : archivage (masquer de la liste admin sans rien supprimer).
ALTER TABLE "Order" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
