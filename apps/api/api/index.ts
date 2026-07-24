// Point d'entrée serverless (Vercel) : NestJS ne peut pas appeler app.listen()
// dans une fonction serverless — on expose plutôt l'instance Express sous-jacente
// comme handler (req, res), réutilisée d'un appel à l'autre pendant que la
// fonction reste "chaude" pour éviter de rebooter Nest à chaque requête.
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AppModule } from '../src/app.module';

let cachedHandler: (req: Request, res: Response) => void;

async function getHandler() {
  if (!cachedHandler) {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
    app.enableCors({ origin: true, credentials: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    cachedHandler = app.getHttpAdapter().getInstance();
  }
  return cachedHandler;
}

export default async function handler(req: Request, res: Response) {
  const server = await getHandler();
  server(req, res);
}
