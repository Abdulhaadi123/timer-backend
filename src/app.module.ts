import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ActivityModule } from './activity/activity.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ScreenshotsModule } from './screenshots/screenshots.module';
import { ProjectsModule } from './projects/projects.module';
import { UsersModule } from './users/users.module';
import { WorkerModule } from './worker/worker.module';
import { AppController } from './app.controller';

const isRedisEnabled = process.env.REDIS_ENABLED !== 'false';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Only register BullMQ if Redis is enabled
    ...(isRedisEnabled
      ? [
          BullModule.forRoot({
            connection: {
              host: process.env.REDIS_HOST || 'localhost',
              port: parseInt(process.env.REDIS_PORT || '6379'),
              password: process.env.REDIS_PASSWORD || undefined,
            },
          }),
        ]
      : []),
    PrismaModule,
    AuthModule,
    ActivityModule,
    OrganizationsModule,
    ScreenshotsModule,
    ProjectsModule,
    UsersModule,
    // Only register WorkerModule if Redis is enabled
    ...(isRedisEnabled ? [WorkerModule] : []),
  ],
  controllers: [AppController],
})
export class AppModule {}
