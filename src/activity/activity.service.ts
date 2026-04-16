import { Injectable, BadRequestException, Optional } from '@nestjs/common';
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
    @Optional() @InjectQueue('activity-rollup') private rollupQueue: Queue,
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
      timezone: user.organization.timezone,
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

    // Close unclosed sessions and queue rollup in background
    if (existingSessions.length > 0) {
      setImmediate(async () => {
        for (const oldSession of existingSessions) {
          console.log(`⚠️ Found unclosed session ${oldSession.id}, closing and processing...`);
          
          await this.prisma.deviceSession.update({
            where: { id: oldSession.id },
            data: { endedAt: new Date() },
          });

          const from = oldSession.startedAt;
          const to = new Date();
          
          if (this.rollupQueue) {
            try {
              await this.rollupQueue.add('rollup-user', { userId: oldSession.userId, from, to });
              console.log(`🔄 Queued rollup for unclosed session ${oldSession.id}`);
            } catch (error) {
              console.log(`⚠️ Redis unavailable, running rollup directly for unclosed session`);
              await this.rollupService.rollupUserActivity(oldSession.userId, from, to);
            }
          } else {
            await this.rollupService.rollupUserActivity(oldSession.userId, from, to);
          }
        }
      });
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

    if (this.rollupQueue) {
      try {
        await this.rollupQueue.add('rollup-user', { userId: session.userId, from, to });
        console.log(`🔄 Queued final rollup for session ${sessionId}`);
      } catch (error) {
        console.log(`⚠️ Redis unavailable, running final rollup directly`);
        await this.rollupService.rollupUserActivity(session.userId, from, to);
      }
    } else {
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
      timezone: user.organization.timezone,
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
    
    const validSamples = [];
    
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const timestamp = new Date(sample.capturedAt);
      
      const localTimeStr = new Intl.DateTimeFormat('en-US', {
        timeZone: rules.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(timestamp).replace('24:', '00:');
      
      const isInCheckin = isWithinCheckinWindow(timestamp, rules);
      const isInBreak = isWithinBreakWindow(timestamp, rules);
      
      if (index === 0) {
        console.log(`🔍 Sample check: Time=${timestamp.toISOString()}, LocalTime=${localTimeStr}, InCheckin=${isInCheckin}, InBreak=${isInBreak}`);
        console.log(`🔍 Rules: checkin=${rules.checkinWindow.start}-${rules.checkinWindow.end}`);
      }

      if (!isInCheckin) {
        if (index === 0) console.log(`❌ Rejected: Outside check-in window`);
        continue;
      }

      if (isInBreak) {
        if (index === 0) console.log(`❌ Rejected: Break time`);
        continue;
      }

      validSamples.push(sample);
    }

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
      
      // Get active session
      const activeSession = await this.prisma.deviceSession.findFirst({
        where: { userId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      
      // Find last processed TimeEntry
      const lastEntry = await this.prisma.timeEntry.findFirst({
        where: { userId, source: 'AUTO' },
        orderBy: { endedAt: 'desc' },
      });
      
      // Use 10-minute lookback to ensure idle threshold detection (5min threshold + buffer), bounded by session start
      let from: Date;
      if (lastEntry && activeSession) {
        const lookbackTime = new Date(lastEntry.endedAt.getTime() - 6 * 60 * 1000);
        from = lookbackTime > activeSession.startedAt ? lookbackTime : activeSession.startedAt;
        console.log(`🔄 Rollup from ${from.toISOString()} (6min lookback, bounded by session)`);
      } else if (activeSession) {
        from = activeSession.startedAt;
        console.log(`🔄 Rollup from session start: ${from.toISOString()}`);
      } else {
        from = new Date(firstSampleTime.getTime() - 6 * 60 * 1000);
        console.log(`🔄 Rollup from 6min before first sample: ${from.toISOString()}`);
      }
      
      const to = lastSampleTime;

      if (this.rollupQueue) {
        try {
          await this.rollupQueue.add('rollup-user', { userId, from, to, projectId });
          console.log(`🔄 Queued rollup job for user ${userId} with project ${projectId || 'None'}`);
        } catch (error) {
          console.log(`⚠️ Redis unavailable, running rollup directly`);
          await this.rollupService.rollupUserActivity(userId, from, to, projectId);
        }
      } else {
        await this.rollupService.rollupUserActivity(userId, from, to, projectId);
      }
    }

    const result = { inserted: validSamples.length, rejected: samples.length - validSamples.length };
    console.log(`📊 Result: Inserted ${result.inserted}, Rejected ${result.rejected}`);
    
    return result;
  }

  async triggerRollup(userId: string) {
    const now = new Date();
    
    // Return immediately, process in background
    setImmediate(async () => {
      try {
        const activeSession = await this.prisma.deviceSession.findFirst({
          where: { userId, endedAt: null },
          orderBy: { startedAt: 'desc' },
        });

        const lastEntry = await this.prisma.timeEntry.findFirst({
          where: { userId, source: 'AUTO' },
          orderBy: { endedAt: 'desc' },
        });

        let from: Date;
        if (lastEntry && activeSession) {
          const lookbackTime = new Date(lastEntry.endedAt.getTime() - 6 * 60 * 1000);
          from = lookbackTime > activeSession.startedAt ? lookbackTime : activeSession.startedAt;
        } else if (activeSession) {
          from = activeSession.startedAt;
        } else {
          from = new Date(now.getTime() - 6 * 60 * 1000);
        }
        
        if (this.rollupQueue) {
          try {
            await this.rollupQueue.add('rollup-user', { userId, from, to: now });
          } catch (error) {
            await this.rollupService.rollupUserActivity(userId, from, now);
          }
        } else {
          await this.rollupService.rollupUserActivity(userId, from, now);
        }
      } catch (error) {
        console.error('Background rollup error:', error);
      }
    });
    
    return { success: true, message: 'Rollup triggered' };
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
    
    // Get user's organization timezone
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { 
        organization: { 
          include: { organization_work_policies: true } 
        },
        tracker_profiles: true,
      },
    });
    const timezone = user?.organization?.timezone || 'UTC';
    const policy = user?.organization?.organization_work_policies;
    const trackerProfile = user?.tracker_profiles;
    
    // Get today's check-in/checkout times from device_sessions
    const firstSession = await this.prisma.deviceSession.findFirst({
      where: {
        userId,
        startedAt: { gte: today },
      },
      orderBy: { startedAt: 'asc' },
    });

    const lastSession = await this.prisma.deviceSession.findFirst({
      where: {
        userId,
        startedAt: { gte: today },
        endedAt: { not: null },
      },
      orderBy: { endedAt: 'desc' },
    });

    const checkinTime = firstSession?.startedAt || null;
    const checkoutTime = lastSession?.endedAt || null;
    
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
        
        // Calculate hourly breakdown for ACTIVE entries in minutes using organization timezone
        let current = new Date(entry.startedAt);
        const end = new Date(entry.endedAt);
        
        while (current < end) {
          // Get hour in organization timezone
          let hourStr = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            hour12: false,
          }).format(current).replace('24', '00');
          const hour = parseInt(hourStr);
          
          // Find next hour boundary using binary search
          const oneHourLater = new Date(current.getTime() + 3600000);
          let low = current.getTime();
          let high = oneHourLater.getTime();
          
          while (high - low > 1000) {
            const mid = Math.floor((low + high) / 2);
            const midDate = new Date(mid);
            let midHourStr = new Intl.DateTimeFormat('en-US', {
              timeZone: timezone,
              hour: '2-digit',
              hour12: false,
            }).format(midDate).replace('24', '00');
            const midHour = parseInt(midHourStr);
            
            if (midHour === hour) {
              low = mid;
            } else {
              high = mid;
            }
          }
          
          const nextHour = new Date(high);
          const segmentEnd = nextHour > end ? end : nextHour;
          const segmentMinutes = Math.floor((segmentEnd.getTime() - current.getTime()) / 60000);
          
          if (segmentMinutes > 0) {
            hourlyData[hour] = (hourlyData[hour] || 0) + segmentMinutes;
          }
          
          current = segmentEnd;
        }
      } else if (entry.kind === 'IDLE') {
        idleSeconds += duration;
      } else if (entry.kind === 'BREAK') {
        breakSeconds += duration;
      }
    }

    const totalSeconds = activeSeconds + idleSeconds + breakSeconds;

    // Calculate activity rate from activitySample
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

    // ✅ PRODUCTION-LEVEL LOGIC: Start from 100% and drop based on inactivity
    let activityRate = 0;
    
    if (firstSession && policy) {
      // Calculate total elapsed time
      const elapsedMs = (now.getTime() - firstSession.startedAt.getTime());
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      
      // ✅ Calculate break time from schedule (not from TimeEntry)
      let calculatedBreakSeconds = 0;
      
      if (policy.break_start && policy.break_end) {
        const formatTime = (time: Date | null) => {
          if (!time) return null;
          const hours = time.getUTCHours().toString().padStart(2, '0');
          const minutes = time.getUTCMinutes().toString().padStart(2, '0');
          return `${hours}:${minutes}`;
        };
        
        const breakStart = formatTime(policy.break_start);
        const breakEnd = formatTime(policy.break_end);
        
        if (breakStart && breakEnd) {
          // Check if user was present during break time today
          const [startHour, startMin] = breakStart.split(':').map(Number);
          const [endHour, endMin] = breakEnd.split(':').map(Number);
          
          const breakStartTime = new Date(today);
          breakStartTime.setUTCHours(startHour, startMin, 0, 0);
          
          const breakEndTime = new Date(today);
          breakEndTime.setUTCHours(endHour, endMin, 0, 0);
          
          // If break end < break start, it's overnight (e.g., 23:00-01:00)
          if (breakEndTime <= breakStartTime) {
            breakEndTime.setUTCDate(breakEndTime.getUTCDate() + 1);
          }
          
          // Calculate overlap between (checkin, now) and (breakStart, breakEnd)
          const sessionStart = firstSession.startedAt.getTime();
          const sessionEnd = now.getTime();
          const breakStartMs = breakStartTime.getTime();
          const breakEndMs = breakEndTime.getTime();
          
          if (sessionEnd > breakStartMs && sessionStart < breakEndMs) {
            const overlapStart = Math.max(sessionStart, breakStartMs);
            const overlapEnd = Math.min(sessionEnd, breakEndMs);
            calculatedBreakSeconds = Math.floor((overlapEnd - overlapStart) / 1000);
            
            if (calculatedBreakSeconds < 0) calculatedBreakSeconds = 0;
          }
        }
      }
      
      const workSeconds = elapsedSeconds - calculatedBreakSeconds; // Exclude break time
      
      // ✅ Grace period - first 30 seconds always 100%
      const GRACE_PERIOD_SECONDS = 30;
      
      if (workSeconds < GRACE_PERIOD_SECONDS) {
        activityRate = 100;
      } else if (workSeconds > 0) {
        // ✅ Exclude grace period from calculation
        const workSecondsAfterGrace = workSeconds - GRACE_PERIOD_SECONDS;
        
        // Expected total seconds (assuming samples every 5 seconds)
        const expectedTotalSeconds = Math.floor(workSecondsAfterGrace / 5) * 5;
        
        if (expectedTotalSeconds > 0) {
          // ✅ Prevent negative inactive seconds
          const inactiveSeconds = Math.max(0, expectedTotalSeconds - totalActiveSeconds);
          
          // Activity rate = 100% - (inactive / expected) * 100
          activityRate = Math.round(100 - (inactiveSeconds / expectedTotalSeconds) * 100);
          
          // Bounds check
          if (activityRate < 0) activityRate = 0;
          if (activityRate > 100) activityRate = 100;
        }
      }
      
      breakSeconds = calculatedBreakSeconds; // Update for logging
    }

    // Removed verbose debug logs for cleaner output

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