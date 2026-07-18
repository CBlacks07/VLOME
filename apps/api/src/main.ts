import 'dotenv/config'; // charge .env (API_PORT, JWT_SECRET…)
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { UPLOADS_DIR } from './uploads/uploads.controller';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api');
  // Images envoyées (produits, tournois) — hors préfixe /api.
  app.useStaticAssets(UPLOADS_DIR, { prefix: '/uploads/' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  const port = process.env.API_PORT ?? 4000;
  await app.listen(port);
  console.log(`VLOME API prête sur http://localhost:${port}/api`);
}
bootstrap();
