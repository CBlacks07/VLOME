import { BadRequestException, ConflictException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

interface UserRow { id: string; email: string; displayName: string; role: string; passwordHash: string; }

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@vlome.tg';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  /** Crée un compte ADMIN par défaut au démarrage s'il n'en existe aucun. */
  async onModuleInit() {
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (admin) return;
    const email = ADMIN_EMAIL.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await this.prisma.user.create({ data: { email, passwordHash, displayName: 'Admin VLOME', role: 'ADMIN' } });
    console.log(`[VLOME] Compte ADMIN créé -> ${email} / ${ADMIN_PASSWORD} (à changer)`);
  }

  private sign(u: UserRow) {
    return this.jwt.sign({ sub: u.id, email: u.email, role: u.role });
  }
  private safe(u: UserRow) {
    return { id: u.id, email: u.email, displayName: u.displayName, role: u.role };
  }

  async register(dto: { email?: string; password?: string; displayName?: string; role?: string }) {
    const email = (dto.email || '').trim().toLowerCase();
    if (!email || !dto.password || dto.password.length < 6) {
      throw new BadRequestException('Email et mot de passe (au moins 6 caractères) requis.');
    }
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Cet email est déjà utilisé.');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = dto.role === 'ORGANIZER' ? 'ORGANIZER' : 'PLAYER'; // ADMIN jamais auto-attribué
    const u = await this.prisma.user.create({
      data: { email, passwordHash, displayName: (dto.displayName || '').trim() || email.split('@')[0], role },
    });
    return { token: this.sign(u), user: this.safe(u) };
  }

  async login(dto: { email?: string; password?: string }) {
    const email = (dto.email || '').trim().toLowerCase();
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || !(await bcrypt.compare(dto.password || '', u.passwordHash))) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    return { token: this.sign(u), user: this.safe(u) };
  }
}
