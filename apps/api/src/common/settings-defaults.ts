// Valeurs par défaut de réglages lus par plusieurs services. Fichier volontairement sans dépendance : les mettre dans
// admin.service créait un import circulaire (tournaments → admin → auth → associations → tournaments) qui faisait
// planter le démarrage de l'API (dépendance « undefined »).

/** Barème des pronostics (carte « Qui va gagner ? ») : points par bon pronostic, et bonus si le choix
 * était outsider (moins de X % des voix) au moment où le pronostic a été fait. */
export const DEFAULT_PREDICTIONS_SETTINGS = { basePoints: 10, outsiderThreshold: 40, outsiderMultiplier: 2 };
/** Multiplicateur de points de classement selon le palier du tournoi (Amateur/Élite, purement un badge
 * sinon) — 1 = aucun effet. Un tournoi sans palier suit le multiplicateur Amateur. */
export const DEFAULT_TIER_POINTS_SETTINGS = { amateurMultiplier: 1, eliteMultiplier: 2 };
