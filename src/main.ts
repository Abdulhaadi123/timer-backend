import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  console.log('🔍 Environment check:');
  console.log('  JWT_SECRET:', process.env.JWT_SECRET ? 'Loaded' : 'NOT LOADED');
  console.log('  NODE_ENV:', process.env.NODE_ENV);
  console.log('  PORT:', process.env.PORT);
  
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // 50MB limit for screenshot uploads (MUST be before CORS)
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors({
    origin: '*',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // Log all incoming requests
  app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    console.log(`🔑 Authorization: ${req.headers.authorization ? req.headers.authorization.substring(0, 30) + '...' : 'NONE'}`);
    next();
  });

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

  console.log(`🔐 JWT_SECRET loaded: ${process.env.JWT_SECRET ? 'YES' : 'NO'}`);
  console.log(`🚀 Backend API running on http://localhost:${port}/api`);
  console.log(`📦 Downloads available at http://localhost:${port}/downloads/`);
  console.log(`📸 Screenshots available at http://localhost:${port}/screenshots/`);
}

bootstrap();
