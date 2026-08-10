import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

/** Secret de signature des jetons de session.
 *
 * Le repli ci-dessous n'existe que pour le développement local. En production il est REFUSÉ :
 * ce dépôt est public, donc un secret écrit en clair ici permettrait à n'importe qui de forger
 * un jeton d'administrateur et de prendre la main sur le site. Mieux vaut un démarrage qui
 * échoue bruyamment qu'une authentification qui ne protège rien.
 */
const DEV_ONLY_SECRET = 'dev-only-change-me';
function jwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv && fromEnv !== DEV_ONLY_SECRET) return fromEnv;
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
