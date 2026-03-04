import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async getOrganization(orgId: string) {
    return this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, timezone: true },
    });
  }

  async getSchedule(orgId: string) {
    console.log('🔍 Looking for work policy - orgId:', orgId);
    
    const workPolicy = await this.prisma.organization_work_policies.findFirst({
      where: { organization_id: orgId },
    });

    console.log('📋 Work policy found:', workPolicy ? 'Yes' : 'No');

    if (!workPolicy) {
      console.log('⚠️  No work policy found, returning defaults');
      return {
        tz: 'UTC',
        checkinStart: '09:00',
        checkinEnd: '18:00',
        breakStart: '12:00',
        breakEnd: '13:00',
        idleThresholdSeconds: 300,
      };
    }

    return {
      tz: workPolicy.timezone || 'UTC',
      checkinStart: workPolicy.shift_start?.toString() || '09:00',
      checkinEnd: workPolicy.shift_end?.toString() || '18:00',
      breakStart: workPolicy.break_start?.toString() || '12:00',
      breakEnd: workPolicy.break_end?.toString() || '13:00',
      idleThresholdSeconds: workPolicy.idle_threshold_seconds || 300,
    };
  }
}
