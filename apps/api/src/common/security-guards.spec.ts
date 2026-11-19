/**
 * Audit automatique : aucune route qui écrit en base (POST/PUT/PATCH/DELETE) ne doit être exposée sans
 * authentification. Né d'un vrai oubli trouvé en revue : `/api/news/seed` n'avait aucun `@UseGuards`,
 * exactement le même genre de faille déjà corrigée une fois sur `/api/tournaments/seed` — ce test
 * empêche qu'elle ne revienne, sur cette route ou une autre, sans qu'on ait besoin d'y repenser.
 *
 * Parcourt tous les `*.controller.ts` du projet, lit les métadonnées posées par Nest (@UseGuards côté
 * classe ET méthode) via `Reflect` — pas besoin de démarrer l'application ni une base de données.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const MUTATING = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);

/** Routes volontairement publiques malgré une écriture en base — chacune vérifiée à la main, à
 *  l'ouverture de ce test, raison donnée en commentaire. Toute autre route mutante doit être gardée. */
const PUBLIC_ALLOWLIST = new Set<string>([
  'auth/register', // crée le compte : point d'entrée, ne peut pas exiger d'être déjà connecté
  'auth/login',
  'auth/forgot-password',
  'auth/reset-password',
  'payments/fedapay/webhook', // notification serveur FedaPay : jamais crue sur parole, revérifiée auprès de FedaPay dans le handler
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function loadControllerClasses(): { file: string; ctrl: Function }[] {
  const out: { file: string; ctrl: Function }[] = [];
  for (const file of walk(path.join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file);
    for (const value of Object.values(mod)) {
      if (typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value) !== undefined) {
        out.push({ file: path.relative(path.join(__dirname, '..', '..'), file), ctrl: value });
      }
    }
  }
  return out;
}

describe('Sécurité — toute route qui écrit en base est authentifiée', () => {
  it('chaque route POST/PUT/PATCH/DELETE a un @UseGuards(JwtAuthGuard) (classe ou méthode), sauf la liste publique vérifiée', () => {
    const violations: string[] = [];
    const checked: string[] = [];

    for (const { file, ctrl } of loadControllerClasses()) {
      const basePath: string = Reflect.getMetadata(PATH_METADATA, ctrl) || '';
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, ctrl) || [];
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        if (name === 'constructor') continue;
        const handler = ctrl.prototype[name];
        const method: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined || !MUTATING.has(method)) continue; // pas une route, ou une lecture (GET)
        const subPath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const route = [basePath, subPath].filter(Boolean).join('/').replace(/\/+/g, '/');
        checked.push(route);
        if (PUBLIC_ALLOWLIST.has(route)) continue;
        const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) || [];
        const hasAuthGuard = [...classGuards, ...methodGuards].includes(JwtAuthGuard);
        if (!hasAuthGuard) violations.push(`${route}  (${file} → ${name})`);
      }
    }

    // Garde-fou du test lui-même : si l'audit n'a rien trouvé à vérifier, il ne protège plus rien.
    expect(checked.length).toBeGreaterThan(20);
    expect(violations).toEqual([]);
  });
});
