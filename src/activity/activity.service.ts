import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RollupService } from './rollup.service';
import { isWithinCheckinWindow, isWithinBreakWindow } from '../shared/utils';
import { randomUUID } from 'crypto';

interface ActivityBatchItem {
  capturedAt: string;
  mouseDelta: number;
  keyCount: number;
  activeSeconds?: number;
  deviceSessionId?: string;
}

@Injectable()
export class ActivityService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('activity-rollup') private rollupQueue: Queue,
    private rollupService: RollupService,
  ) {}

  async startSession(userId: string, deviceId: string, platform: string) {
    // Check if current time is within check-in window
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { 
        organization: { 
          include: { organization_work_policies: true } 
        },
        tracker_profiles: true,
      },
    });

    if (!user || !user.organization.organization_work_policies) {
      throw new BadRequestException('User or organization policy not found');
    }

    const policy = user.organization.organization_work_policies;
    const trackerProfile = user.tracker_profiles;
    
    const formatTime = (time: Date | null) => {
      if (!time) return null;
      const hours = time.getUTCHours().toString().padStart(2, '0');
      const minutes = time.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    };
    
    const rules = {
      timezone: policy.timezone,
      checkinWindow: {
        start: trackerProfile?.custom_schedule_start ? formatTime(trackerProfile.custom_schedule_start) : formatTime(policy.shift_start) || '09:00',
        end: trackerProfile?.custom_schedule_end ? formatTime(trackerProfile.custom_schedule_end) : formatTime(policy.shift_end) || '18:00',
      },
      breakWindow: {
        start: formatTime(policy.break_start) || '12:00',
        end: formatTime(policy.break_end) || '13:00',
      },
      idleThresholdSeconds: policy.idle_threshold_seconds,
    };

    const now = new Date();
    const isInCheckin = isWithinCheckinWindow(now, rules);
    
    if (!isInCheckin) {
      throw new BadRequestException(`Tracking can only be started during office hours (${rules.checkinWindow.start} - ${rules.checkinWindow.end})`);
    }

    const existingSessions = await this.prisma.deviceSession.findMany({
      where: { userId, deviceId, endedAt: null },
    });

    for (const oldSession of existingSessions) {
      console.log(`⚠️ Found unclosed session ${oldSession.id}, closing and processing...`);
      
      await this.prisma.deviceSession.update({
        where: { id: oldSession.id },
        data: { endedAt: new Date() },
      });

      const from = oldSession.startedAt;
      const to = new Date();
      
      try {
        await this.rollupQueue.add('rollup-user', { userId: oldSession.userId, from, to });
        console.log(`🔄 Queued rollup for unclosed session ${oldSession.id}`);
      } catch (error) {
        console.log(`⚠️ Redis unavailable, running rollup directly for unclosed session`);
        await this.rollupService.rollupUserActivity(oldSession.userId, from, to);
      }
    }

    const session = await this.prisma.deviceSession.create({
      data: { 
        id: randomUUID(),
        userId, 
        deviceId, 
        platform, 
        startedAt: new Date() 
      },
    });

    console.log(`✅ Created new session ${session.id}`);
    return session;
  }

  async stopSession(sessionId: string) {
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
    }

    const updatedSession = await this.prisma.deviceSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });

    const from = session.startedAt;
    const to = new Date();

    try {
      await this.rollupQueue.add('rollup-user', { userId: session.userId, from, to });
      console.log(`🔄 Queued final rollup for session ${sessionId}`);
    } catch (error) {
      console.log(`⚠️ Redis unavailable, running final rollup directly`);
      await this.rollupService.rollupUserActivity(session.userId, from, to);
    }

    return updatedSession;
  }

  async batchUpload(userId: string, samples: ActivityBatchItem[], projectId?: string) {
    console.log(`📥 Received batch upload: ${samples.length} samples from user ${userId}, project: ${projectId || 'None'}`);
    
    if (samples.length === 0) {
      return { inserted: 0 };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { 
        organization: { 
          include: { organization_work_policies: true } 
        },
        tracker_profiles: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.organization.organization_work_policies) {
      throw new BadRequestException('Organization work policy not configured');
    }

    const policy = user.organization.organization_work_policies;
    const trackerProfile = user.tracker_profiles;
    
    const formatTime = (time: Date | null) => {
      if (!time) return null;
      const hours = time.getUTCHours().toString().padStart(2, '0');
      const minutes = time.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    };
    
    const rules = {
      timezone: policy.timezone,
      checkinWindow: {
        start: trackerProfile?.custom_schedule_start ? formatTime(trackerProfile.custom_schedule_start) : formatTime(policy.shift_start) || '09:00',
        end: trackerProfile?.custom_schedule_end ? formatTime(trackerProfile.custom_schedule_end) : formatTime(policy.shift_end) || '18:00',
      },
      breakWindow: {
        start: formatTime(policy.break_start) || '12:00',
        end: formatTime(policy.break_end) || '13:00',
      },
      idleThresholdSeconds: policy.idle_threshold_seconds,
    };

    console.log(`⏰ Schedule: Check-in ${rules.checkinWindow.start}-${rules.checkinWindow.end}, Break ${rules.breakWindow.start}-${rules.breakWindow.end}, TZ: ${rules.timezone}`);
    
    const validSamples = samples.filter((sample, index) => {
      const timestamp = new Date(sample.capturedAt);
      const isInCheckin = isWithinCheckinWindow(timestamp, rules);
      const isInBreak = isWithinBreakWindow(timestamp, rules);
      
      if (index === 0) {
        console.log(`🔍 Sample check: Time=${timestamp.toISOString()}, InCheckin=${isInCheckin}, InBreak=${isInBreak}`);
      }

      if (!isInCheckin) {
        if (index === 0) console.log(`❌ Rejected: Outside check-in window`);
        return false;
      }

      if (isInBreak) {
        if (index === 0) console.log(`❌ Rejected: During break time`);
        return false;
      }

      // Log activity rate
      console.log(`📊 Activity rate: mouse=${sample.mouseDelta}, keys=${sample.keyCount}`);
      return true;
    });

    if (validSamples.length > 0) {
      const dataToInsert = validSamples.map((sample) => ({
        userId,
        capturedAt: new Date(sample.capturedAt),
        mouseDelta: sample.mouseDelta,
        keyCount: sample.keyCount,
        activeSeconds: sample.activeSeconds ?? null,
        deviceSessionId: sample.deviceSessionId || null,
      }));
      
      await this.prisma.activitySample.createMany({ data: dataToInsert });

      console.log(`✅ Inserted ${validSamples.length} samples into database`);

      const firstSampleTime = new Date(validSamples[0].capturedAt);
      const lastSampleTime = new Date(validSamples[validSamples.length - 1].capturedAt);
      const from = new Date(firstSampleTime.getTime() - 5 * 60 * 1000);
      const to = lastSampleTime;

      try {
        await this.rollupQueue.add('rollup-user', { userId, from, to, projectId });
        console.log(`🔄 Queued rollup job for user ${userId} with project ${projectId || 'None'}`);
      } catch (error) {
        console.log(`⚠️ Redis unavailable, running rollup directly`);
        await this.rollupService.rollupUserActivity(userId, from, to, projectId);
      }
    }

    const result = { inserted: validSamples.length, rejected: samples.length - validSamples.length };
    console.log(`📊 Result: Inserted ${result.inserted}, Rejected ${result.rejected}`);
    
    return result;
  }

  async triggerRollup(userId: string) {
    const now = new Date();
    const activeSession = await this.prisma.deviceSession.findFirst({
      where: { userId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    const from = activeSession ? activeSession.startedAt : new Date(now.getTime() - 10 * 60 * 1000);
    
    try {
      await this.rollupQueue.add('rollup-user', { userId, from, to: now });
      console.log(`🔄 Rollup queued for user ${userId} from ${from.toISOString()}`);
      return { success: true, message: 'Rollup triggered' };
    } catch (error) {
      console.log(`⚠️ Redis unavailable, running rollup directly`);
      await this.rollupService.rollupUserActivity(userId, from, now);
      return { success: true, message: 'Rollup completed directly' };
    }
  }

  async getActiveUsers() {
    const activeSessions = await this.prisma.deviceSession.findMany({
      where: { endedAt: null },
      include: {
        user: {
          select: { id: true, email: true, fullName: true },
        },
      },
    });

    return activeSessions.map(session => ({
      userId: session.userId,
      email: session.user.email,
      fullName: session.user.fullName,
      startedAt: session.startedAt,
      deviceId: session.deviceId,
      platform: session.platform,
    }));
  }

  async getMyStats(userId: string) {
    const now = new Date();
    // Use UTC midnight for consistent date filtering
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    
    // Get today's check-in/checkout times from device_sessions
    const todaySession = await this.prisma.deviceSession.findFirst({
      where: {
        userId,
        startedAt: { gte: today },
      },
      orderBy: { startedAt: 'asc' },
    });

    const checkinTime = todaySession?.startedAt || null;
    const checkoutTime = todaySession?.endedAt || null;
    
    // Get time entries for display
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        userId,
        source: 'AUTO',
        startedAt: { gte: today },
      },
    });

    let activeSeconds = 0;
    let idleSeconds = 0;
    let breakSeconds = 0;
    const hourlyData: { [hour: number]: number } = {};

    for (const entry of entries) {
      const duration = Math.floor((entry.endedAt.getTime() - entry.startedAt.getTime()) / 1000);
      if (entry.kind === 'ACTIVE') {
        activeSeconds += duration;
        
        // Calculate hourly breakdown for ACTIVE entries in minutes
        let current = new Date(entry.startedAt);
        const end = new Date(entry.endedAt);
        
        while (current < end) {
          const hour = current.getHours();
          const nextHour = new Date(current);
          nextHour.setHours(hour + 1, 0, 0, 0);
          
          const segmentEnd = nextHour > end ? end : nextHour;
          const segmentMinutes = Math.floor((segmentEnd.getTime() - current.getTime()) / 60000);
          
          hourlyData[hour] = (hourlyData[hour] || 0) + segmentMinutes;
          current = segmentEnd;
        }
      } else if (entry.kind === 'IDLE') {
        idleSeconds += duration;
      } else if (entry.kind === 'BREAK') {
        breakSeconds += duration;
      }
    }

    const totalSeconds = activeSeconds + idleSeconds + breakSeconds;

    // Calculate activity rate from activitySample (like old backend)
    const samples = await this.prisma.activitySample.findMany({
      where: {
        userId,
        capturedAt: { gte: today },
      },
      select: {
        activeSeconds: true,
      },
    });

    let totalActiveSeconds = 0;
    let totalSampleSeconds = 0;
    let samplesWithData = 0;

    for (const sample of samples) {
      if (sample.activeSeconds != null) {
        totalActiveSeconds += sample.activeSeconds;
        totalSampleSeconds += 5; // Each sample is 5 seconds
        samplesWithData++;
      }
    }

    const activityRate = totalSampleSeconds > 0 
      ? Math.round((totalActiveSeconds / totalSampleSeconds) * 100) 
      : 0;

    console.log(`\n========== 📊 MY STATS DEBUG ==========`);
    console.log(`🔍 Debug Info:`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Today (Local): ${new Date().toISOString()}`);
    console.log(`   Today (UTC): ${today.toISOString()}`);
    console.log(`   Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`\n⏰ Session Info:`);
    console.log(`   Check-in: ${checkinTime?.toISOString() || 'Not checked in'}`);
    console.log(`   Checkout: ${checkoutTime?.toISOString() || 'Still active'}`);
    console.log(`\n⏱️  Time Entries (from TimeEntry table):`);
    console.log(`   Active Time: ${activeSeconds}s (${Math.floor(activeSeconds/60)}m)`);
    console.log(`   Idle Time: ${idleSeconds}s (${Math.floor(idleSeconds/60)}m)`);
    console.log(`   Break Time: ${breakSeconds}s (${Math.floor(breakSeconds/60)}m)`);
    console.log(`   Total Time: ${totalSeconds}s (${Math.floor(totalSeconds/60)}m)`);
    console.log(`\n📈 Activity Rate (from ActivitySample table):`);
    console.log(`   Total Samples: ${samplesWithData}`);
    console.log(`   Active Seconds: ${totalActiveSeconds}`);
    console.log(`   Total Sample Seconds: ${totalSampleSeconds}`);
    console.log(`   Formula: (${totalActiveSeconds} / ${totalSampleSeconds}) × 100`);
    console.log(`   Result: ${activityRate}%`);
    console.log(`========================================\n`);

    return {
      checkinTime,
      checkoutTime,
      activeSeconds,
      idleSeconds,
      breakSeconds,
      totalSeconds,
      activityRate,
      hourlyData,
    };
  }
}
