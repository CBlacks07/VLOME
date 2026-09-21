// Certains navigateurs et robots (dont celui de Google) demandent /favicon.ico sans lire les balises <link> :
// on les renvoie vers l'icône générée depuis le logo de l'admin plutôt que de livrer un fichier fixe.
export function GET(req: Request) {
  return Response.redirect(new URL("/pwa-icon/48", req.url), 307);
}
