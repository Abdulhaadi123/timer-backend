import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('activity')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  @Post('sessions/start')
  async startSession(@Request() req, @Body() body: { deviceId: string; platform: string }) {
    return this.activityService.startSession(req.user.id, body.deviceId, body.platform);
  }

  @Post('sessions/stop')
  async stopSession(@Body() body: { sessionId: string }) {
    return this.activityService.stopSession(body.sessionId);
  }

  @Post('batch')
  async batchUpload(@Request() req, @Body() body: { samples: any[]; projectId?: string }) {
    return this.activityService.batchUpload(req.user.id, body.samples, body.projectId);
  }

  @Post('rollup')
  async triggerRollup(@Request() req) {
    return this.activityService.triggerRollup(req.user.id);
  }

  @Get('my-stats')
  async getMyStats(@Request() req) {
    return this.activityService.getMyStats(req.user.id);
  }
}
