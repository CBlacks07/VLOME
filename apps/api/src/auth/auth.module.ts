import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

/** Secret de signature des jetons de session.
 *
 * Le repli ci-dessous n'existe que pour le développement local. En production il n'est jamais
 * utilisé : un secret écrit en clair dans le dépôt permettrait de forger un jeton d'administrateur.
 * À défaut de JWT_SECRET, on tire un secret aléatoire — le service reste en ligne et sûr, mais les
 * sessions ne survivent pas au redémarrage de l'instance (voir SESSION_SECRET_CONFIGURED).
 */
const DEV_ONLY_SECRET = 'dev-only-change-me';
/** Exposé (en booléen seulement, jamais la valeur) à l'admin, pour diagnostiquer sans accès serveur. */
export let SESSION_SECRET_CONFIGURED = false;
function jwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv && fromEnv !== DEV_ONLY_SECRET) { SESSION_SECRET_CONFIGURED = true; return fromEnv; }
  if (process.env.NODE_ENV === 'production') {
    // Secret manquant en production : on NE démarre PAS avec la valeur publique (n'importe qui
    // forgerait un jeton d'administrateur), mais on ne fait pas non plus tomber le site. Repli sur
    // un secret aléatoire propre à cette instance : le service reste en ligne et les jetons forgés
    // sont refusés — au prix de sessions qui ne survivent pas au redémarrage de l'instance, d'où
    // l'alerte ci-dessous. Définir JWT_SECRET rétablit des sessions stables.
    console.error(
      '[Miabe] JWT_SECRET absent en production : repli sur un secret aléatoire temporaire. ' +
      'Les utilisateurs seront déconnectés à chaque redémarrage tant que la variable ne sera pas définie.',
    );
    return randomBytes(48).toString('base64url');
  }
  return DEV_ONLY_SECRET;
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: jwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
