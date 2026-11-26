import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Lecture publique qui reconnaît quand même la personne connectée (jeton valide), sans jamais refuser. */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth: string = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
      try { req.user = this.jwt.verify(auth.slice(7)); } catch { /* jeton expiré : visiteur anonyme */ }
    }
    return true;
  }
}
