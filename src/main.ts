// external imports
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
// internal imports
import { AppModule } from './app.module';
import appConfig from './config/app.config';
import { CustomExceptionFilter } from './common/exception/custom-exception.filter';
import { SojebStorage } from './common/lib/Disk/SojebStorage';
import {
  buildSwaggerOptions,
  swaggerUiOptions,
} from './common/swagger/swagger-auth';
import { SecurityMiddleware } from './common/middleware/security.middleware';
import { SuspiciousPathMiddleware } from './common/middleware/suspicious-path.middleware';
import { createRateLimiter } from './common/middleware/rate-limit.middleware';
import { NextFunction, Request, Response } from 'express';
import { helmetConfig } from './common/config/helmet.cofig';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin:
      appConfig().app.node_env === 'production'
        ? ['https://roofwellnesshub.com']
        : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
  });

  // ─── Security Middleware ───────────────────────────────────────────
  const securityMiddleware = new SecurityMiddleware();
  const suspiciousPathMiddleware = new SuspiciousPathMiddleware();

  app.use((req: Request, res: Response, next: NextFunction) =>
    securityMiddleware.use(req, res, next),
  );
  app.use((req: Request, res: Response, next: NextFunction) =>
    suspiciousPathMiddleware.use(req, res, next),
  );

  // ─── Rate Limiters ────────────────────────────────────────────────
  app.use('/api', createRateLimiter('GENERAL'));
  app.use('/api/auth', createRateLimiter('AUTH'));

  // ─── Helmet ───────────────────────────────────────────────────────
  app.use(helmetConfig());

  app.useStaticAssets(join(process.cwd(), 'public'), {
    index: false,
    prefix: '/public',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );
  app.useGlobalFilters(new CustomExceptionFilter());

  // ─── Storage Setup ────────────────────────────────────────────────
  SojebStorage.config({
    driver: 'local',
    connection: {
      rootUrl: appConfig().storageUrl.rootUrl,
      publicUrl: appConfig().storageUrl.rootUrlPublic,
      awsBucket: appConfig().fileSystems.s3.bucket,
      awsAccessKeyId: appConfig().fileSystems.s3.key,
      awsSecretAccessKey: appConfig().fileSystems.s3.secret,
      awsDefaultRegion: appConfig().fileSystems.s3.region,
      awsEndpoint: appConfig().fileSystems.s3.endpoint,
      minio: true,
      gcpProjectId: appConfig().fileSystems.gcs.projectId,
      gcpKeyFile: appConfig().fileSystems.gcs.keyFile,
      gcpApiEndpoint: appConfig().fileSystems.gcs.apiEndpoint,
      gcpBucket: appConfig().fileSystems.gcs.bucket,
    },
  });

  // ─── Swagger ──────────────────────────────────────────────────────
  const document = SwaggerModule.createDocument(app, buildSwaggerOptions());
  SwaggerModule.setup('api/docs', app, document, swaggerUiOptions);

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0');
}
bootstrap();
