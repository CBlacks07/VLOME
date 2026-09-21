import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtUser { sub: string; email: string; role: string; }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth: string = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Connexion requise.');
    try {
      req.user = this.jwt.verify(token) as JwtUser;
    } catch {
      throw new UnauthorizedException('Session invalide ou expirée.');
    }
    // Club demandé à l'inscription et pas encore validé par un admin : le compte peut consulter le site
    // (GET) et gérer sa session (/auth), mais ne peut rien faire d'autre — inscription à un tournoi,
    // commande, paiement, etc. Seules les requêtes qui modifient quelque chose sont bloquées.
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !String(req.originalUrl || req.url || '').startsWith('/api/auth')) {
      const u = await this.prisma.user.findUnique({ where: { id: req.user.sub }, select: { clubBlocking: true, clubRequested: true } });
      if (u?.clubBlocking) {
        throw new ForbiddenException(`Ton compte est en attente de validation : l'administrateur doit d'abord valider ton club « ${u.clubRequested || ''} ». Tu pourras ensuite participer et utiliser le site.`);
      }
    }
    return true;
  }
}
