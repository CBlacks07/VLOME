import type { Request, Response, NextFunction } from 'express';

/**
 * Interdit la mise en cache des réponses de l'API.
 *
 * Deux raisons :
 * - Ces réponses sont dynamiques (tournois en direct, réglages, panier…) : les servir depuis un
 *   cache affiche des données périmées.
 * - Surtout, elles portent des en-têtes CORS qui dépendent du domaine appelant. Avec une réponse
 *   mise en cache puis revalidée, le navigateur reçoit un 304 sans nouvel en-tête et réutilise
 *   l'« Access-Control-Allow-Origin » stocké — celui d'un AUTRE domaine. Le navigateur bloque alors
 *   la requête ("...has a value ... that is not equal to the supplied origin"), alors même que le
 *   serveur répond correctement. Ne rien mettre en cache supprime cette classe de panne.
 */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
