import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ActivityModule } from '../activity/activity.module';
import { RollupProcessor } from './processors/rollup.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'activity-rollup',
    }),
    ActivityModule,
  ],
  providers: [RollupProcessor],
})
export class WorkerModule {}
