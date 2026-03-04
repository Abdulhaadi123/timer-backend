import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RollupService } from '../../activity/rollup.service';

@Processor('activity-rollup')
export class RollupProcessor extends WorkerHost {
  constructor(private rollupService: RollupService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'rollup-user':
        return this.handleRollupUser(job);
      case 'rollup-session':
        return this.handleRollupSession(job);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  }

  private async handleRollupUser(
    job: Job<{ userId: string; from: Date; to: Date; projectId?: string }>,
  ) {
    const { userId, from, to, projectId } = job.data;
    return this.rollupService.rollupUserActivity(
      userId,
      new Date(from),
      new Date(to),
      projectId,
    );
  }

  private async handleRollupSession(
    job: Job<{ userId: string; sessionId: string }>,
  ) {
    const { userId } = job.data;
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);

    return this.rollupService.rollupUserActivity(userId, from, to);
  }
}
