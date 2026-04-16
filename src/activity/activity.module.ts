import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { RollupService } from './rollup.service';

const isRedisEnabled = process.env.REDIS_ENABLED !== 'false';

@Module({
  imports: [
    // Only register queue if Redis is enabled
    ...(isRedisEnabled
      ? [
          BullModule.registerQueue({
            name: 'activity-rollup',
          }),
        ]
      : []),
  ],
  controllers: [ActivityController],
  providers: [ActivityService, RollupService],
  exports: [ActivityService, RollupService],
})
export class ActivityModule {}
