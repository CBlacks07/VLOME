import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
    throw new Error(
      "JWT_SECRET manquant : définis une valeur secrète et unique dans les variables d'environnement " +
      "(ex. `node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"`). " +
      'Sans elle, les jetons de session seraient signés avec une valeur publique.',
    );
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
