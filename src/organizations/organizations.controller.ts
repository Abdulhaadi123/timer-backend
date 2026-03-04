import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private organizationsService: OrganizationsService) {}

  @Get('me')
  async getOrganization(@Request() req) {
    return this.organizationsService.getOrganization(req.user.orgId);
  }

  @Get('schedule')
  async getSchedule(@Request() req) {
    console.log('📋 Schedule request - User:', req.user);
    if (!req.user.orgId) {
      throw new Error('User orgId is missing');
    }
    return this.organizationsService.getSchedule(req.user.orgId);
  }
}
