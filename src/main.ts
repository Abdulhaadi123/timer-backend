import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // 50MB limit for screenshot uploads (MUST be before CORS)
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors({
    origin: ['http://localhost:5175', 'http://localhost:3000'],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // Serve static files from public/downloads directory
  const downloadsPath = join(__dirname, '..', 'public', 'downloads');
  app.useStaticAssets(downloadsPath, {
    prefix: '/downloads',
  });

  // Serve screenshots from public/screenshots directory
  const screenshotsPath = join(__dirname, '..', 'public', 'screenshots');
  app.useStaticAssets(screenshotsPath, {
    prefix: '/screenshots',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Backend API running on http://localhost:${port}/api`);
  console.log(`📦 Downloads available at http://localhost:${port}/downloads/`);
  console.log(`📸 Screenshots available at http://localhost:${port}/screenshots/`);
}

bootstrap();
