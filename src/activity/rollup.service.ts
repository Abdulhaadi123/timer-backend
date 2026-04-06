import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isWithinCheckinWindow, isWithinBreakWindow, hasActivity } from '../shared/utils';
import { startOfMinute, addMinutes } from 'date-fns';

interface MinuteBucket {
  start: Date;
  end: Date;
  samples: Array<{ mouseDelta: number; keyCount: number; activeSeconds?: number }>;
}

@Injectable()
export class RollupService {
  constructor(private prisma: PrismaService) {}

  async rollupUserActivity(userId: string, from: Date, to: Date, projectId?: string) {
    try {
      console.log(`🔄 Starting rollup for user ${userId} from ${from.toISOString()} to ${to.toISOString()}, project: ${projectId || 'None'}`);
      
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
        console.error('❌ User not found:', userId);
        return;
      }

      const workPolicy = user.organization.organization_work_policies;

      if (!workPolicy) {
        console.error('❌ Work policy not configured for organization:', user.orgId);
        return;
      }

      const trackerProfile = user.tracker_profiles;
      
      const formatTime = (time: Date | null) => {
        if (!time) return null;
        const hours = time.getUTCHours().toString().padStart(2, '0');
        const minutes = time.getUTCMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
      };
      
      const rules = {
        timezone: user.organization.timezone || 'UTC',
        checkinWindow: {
          start: trackerProfile?.custom_schedule_start ? formatTime(trackerProfile.custom_schedule_start) : formatTime(workPolicy.shift_start) || '09:00',
          end: trackerProfile?.custom_schedule_end ? formatTime(trackerProfile.custom_schedule_end) : formatTime(workPolicy.shift_end) || '18:00',
        },
        breakWindow: {
          start: formatTime(workPolicy.break_start) || '12:00',
          end: formatTime(workPolicy.break_end) || '13:00',
        },
        idleThresholdSeconds: workPolicy.idle_threshold_seconds || 300,
      };

      const samples = await this.prisma.activitySample.findMany({
        where: { userId, capturedAt: { gte: from, lte: to } },
        orderBy: { capturedAt: 'asc' },
      });

      console.log(`📊 Found ${samples.length} samples to process`);

      if (samples.length === 0) {
        console.log('⚠️ No samples to process');
        return;
      }

      const minuteBuckets = this.groupByMinute(samples);
      const minuteEntries: Array<{
        userId: string;
        startedAt: Date;
        endedAt: Date;
        hasActivity: boolean;
        isBreak?: boolean;
      }> = [];

      for (const bucket of minuteBuckets) {
        if (!isWithinCheckinWindow(bucket.start, rules)) continue;
        
        // ✅ Check if in break time - mark as break
        if (isWithinBreakWindow(bucket.start, rules)) {
          minuteEntries.push({
            userId,
            startedAt: bucket.start,
            endedAt: bucket.end,
            hasActivity: false,
            isBreak: true,
          });
          continue;
        }

        // Check activity using activeSeconds field (more accurate) or fallback to mouse/key
        const active = bucket.samples.some((s) => 
          (s.activeSeconds !== undefined && s.activeSeconds !== null && s.activeSeconds > 0) ||
          hasActivity(s.mouseDelta, s.keyCount)
        );
        minuteEntries.push({
          userId,
          startedAt: bucket.start,
          endedAt: bucket.end,
          hasActivity: active,
          isBreak: false,
        });
      }

      console.log(`🎯 Applying idle threshold: ${rules.idleThresholdSeconds}s (${Math.floor(rules.idleThresholdSeconds / 60)} minutes)`);
      const entries = this.applyIdleThreshold(minuteEntries, rules.idleThresholdSeconds);
      const merged = this.mergeContiguous(entries);

      await this.prisma.$transaction(async (tx) => {
        if (merged.length === 0) return;

        for (const newEntry of merged) {
          const entryWithProject = { ...newEntry, projectId: projectId || null };
          
          const existingExact = await tx.timeEntry.findFirst({
            where: {
              userId,
              source: 'AUTO',
              kind: newEntry.kind,
              startedAt: newEntry.startedAt,
              endedAt: newEntry.endedAt,
            },
          });

          if (existingExact) {
            console.log(`⏭️  Skipping duplicate: ${newEntry.kind} ${newEntry.startedAt.toISOString()}`);
            continue;
          }

          // Find conflicting entries of opposite kind that truly overlap
          // Use strict time comparison to avoid millisecond boundary issues
          const conflicting = await tx.timeEntry.findMany({
            where: {
              userId,
              source: 'AUTO',
              kind: { not: newEntry.kind },
              startedAt: { lt: newEntry.endedAt },
              endedAt: { gt: newEntry.startedAt },
            },
          });
          
          // Filter out exact boundary matches (adjacent entries)
          const trueConflicts = conflicting.filter(c => {
            const cStart = c.startedAt.getTime();
            const cEnd = c.endedAt.getTime();
            const nStart = newEntry.startedAt.getTime();
            const nEnd = newEntry.endedAt.getTime();
            
            // Exclude if conflict ends exactly where new starts (adjacent)
            if (cEnd === nStart) return false;
            
            // Exclude if conflict starts exactly where new ends (adjacent)
            if (cStart === nEnd) return false;
            
            return true;
          });

          // If new entry conflicts with existing entries of opposite kind:
          // - ACTIVE should overwrite IDLE (real activity takes priority)
          // - IDLE should NOT overwrite ACTIVE (preserve real activity)
          // But allow IDLE to be added in new time periods (no full overlap)
          if (newEntry.kind === 'IDLE' && trueConflicts.length > 0) {
            // Check if there's a conflicting ACTIVE that fully covers this IDLE period
            const fullyOverlapped = trueConflicts.some(c => 
              c.kind === 'ACTIVE' && 
              c.startedAt <= newEntry.startedAt && 
              c.endedAt >= newEntry.endedAt
            );
            
            if (fullyOverlapped) {
              console.log(`⏭️  Skipping IDLE entry fully covered by existing ACTIVE: ${newEntry.startedAt.toISOString()}`);
              continue;
            }
          }

          // Collect all operations to execute in batch
          const toDelete: bigint[] = [];
          const toCreate: any[] = [];

          for (const conflict of trueConflicts) {
            toDelete.push(conflict.id);

            if (conflict.startedAt < newEntry.startedAt) {
              toCreate.push({
                userId,
                startedAt: conflict.startedAt,
                endedAt: newEntry.startedAt,
                kind: conflict.kind,
                source: 'AUTO',
              });
            }

            if (conflict.endedAt > newEntry.endedAt) {
              toCreate.push({
                userId,
                startedAt: newEntry.endedAt,
                endedAt: conflict.endedAt,
                kind: conflict.kind,
                source: 'AUTO',
              });
            }
          }

          // Execute deletes and creates in batch (atomic)
          if (toDelete.length > 0) {
            await tx.timeEntry.deleteMany({
              where: { id: { in: toDelete } },
            });
          }

          if (toCreate.length > 0) {
            await tx.timeEntry.createMany({
              data: toCreate,
            });
          }

          // Don't merge with any existing entries - just insert if no exact duplicate
          // This prevents IDLE-to-ACTIVE conversion and keeps entries separate
          await tx.timeEntry.create({ data: entryWithProject });
          if (newEntry.kind === 'ACTIVE') {
            console.log(`✅ ACTIVE time ho raha hai: ${newEntry.startedAt.toISOString()} to ${newEntry.endedAt.toISOString()}`);
          } else {
            console.log(`⏸️ IDLE time ho raha hai: ${newEntry.startedAt.toISOString()} to ${newEntry.endedAt.toISOString()}`);
          }
        }
      }, { timeout: 15000 });

      console.log(`✅ Rollup complete: Processed ${merged.length} entries`);
      return { processed: merged.length };

    } catch (error) {
      console.error('❌ Rollup failed:', error);
      throw error;
    }
  }

  private groupByMinute(samples: Array<{ capturedAt: Date; mouseDelta: number; keyCount: number }>): MinuteBucket[] {
    const buckets = new Map<number, MinuteBucket>();

    for (const sample of samples) {
      const minuteStart = startOfMinute(sample.capturedAt);
      const minuteEnd = addMinutes(minuteStart, 1);
      const key = minuteStart.getTime();

      if (!buckets.has(key)) {
        buckets.set(key, { start: minuteStart, end: minuteEnd, samples: [] });
      }

      buckets.get(key)!.samples.push({
        mouseDelta: sample.mouseDelta,
        keyCount: sample.keyCount,
        activeSeconds: (sample as any).activeSeconds,
      });
    }

    return Array.from(buckets.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private applyIdleThreshold(
    minuteEntries: Array<{ userId: string; startedAt: Date; endedAt: Date; hasActivity: boolean }>,
    idleThresholdSeconds: number,
  ): Array<{ userId: string; startedAt: Date; endedAt: Date; kind: 'ACTIVE' | 'IDLE'; source: 'AUTO' }> {
    const entries: Array<{ userId: string; startedAt: Date; endedAt: Date; kind: 'ACTIVE' | 'IDLE'; source: 'AUTO' }> = [];
    const idleThresholdMinutes = Math.floor(idleThresholdSeconds / 60);
    let consecutiveIdleCount = 0;
    let pendingIdleEntries: Array<typeof entries[0]> = [];

    console.log(`📋 Processing ${minuteEntries.length} minute entries with threshold ${idleThresholdMinutes} minutes`);

    for (let i = 0; i < minuteEntries.length; i++) {
      const entry = minuteEntries[i];

      if (entry.hasActivity) {
        console.log(`  ✅ Minute ${i + 1}: ACTIVE (has activity) - reset idle counter`);
        
        if (pendingIdleEntries.length > 0) {
          console.log(`    → Flushing ${pendingIdleEntries.length} pending minutes as ACTIVE`);
          entries.push(...pendingIdleEntries);
          pendingIdleEntries = [];
        }
        consecutiveIdleCount = 0;
        
        entries.push({
          userId: entry.userId,
          startedAt: entry.startedAt,
          endedAt: entry.endedAt,
          kind: 'ACTIVE',
          source: 'AUTO',
        });
      } else {
        consecutiveIdleCount++;
        console.log(`  ⏸️  Minute ${i + 1}: No activity - consecutive idle: ${consecutiveIdleCount}/${idleThresholdMinutes}`);

        if (consecutiveIdleCount > idleThresholdMinutes) {
          console.log(`    → Already past threshold, adding as IDLE`);
          entries.push({
            userId: entry.userId,
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            kind: 'IDLE',
            source: 'AUTO',
          });
        } else {
          const pendingEntry = {
            userId: entry.userId,
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            kind: 'ACTIVE' as const,
            source: 'AUTO' as const,
          };
          pendingIdleEntries.push(pendingEntry);

          if (consecutiveIdleCount === idleThresholdMinutes) {
            console.log(`    → Threshold reached! Converting ${pendingIdleEntries.length} minutes to IDLE`);
            const idleEntries = pendingIdleEntries.map(e => ({ ...e, kind: 'IDLE' as const }));
            entries.push(...idleEntries);
            pendingIdleEntries = [];
          }
        }
      }
    }

    if (pendingIdleEntries.length > 0) {
      console.log(`  → Flushing ${pendingIdleEntries.length} pending minutes as ACTIVE (threshold not reached)`);
      entries.push(...pendingIdleEntries);
    }

    const activeCount = entries.filter(e => e.kind === 'ACTIVE').length;
    const idleCount = entries.filter(e => e.kind === 'IDLE').length;
    console.log(`📊 Result: ${activeCount} ACTIVE, ${idleCount} IDLE entries`);

    return entries;
  }

  private mergeContiguous(
    entries: Array<{ userId: string; startedAt: Date; endedAt: Date; kind: 'ACTIVE' | 'IDLE'; source: 'AUTO' }>,
  ) {
    if (entries.length === 0) return [];

    const merged: typeof entries = [];
    let current = { ...entries[0] };

    for (let i = 1; i < entries.length; i++) {
      const next = entries[i];

      if (next.startedAt.getTime() === current.endedAt.getTime() && next.kind === current.kind) {
        current.endedAt = next.endedAt;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    return merged;
  }
}
