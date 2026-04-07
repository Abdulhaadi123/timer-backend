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

      if (samples.length === 0) {
        return;
      }

      const minuteBuckets = this.groupByMinute(samples);
      
      // Get existing time entries to avoid reprocessing
      // Include entries that overlap with the rollup window (not just those that start in it)
      const existingEntries = await this.prisma.timeEntry.findMany({
        where: {
          userId,
          source: 'AUTO',
          startedAt: { lt: to },
          endedAt: { gt: from },
        },
        select: { startedAt: true, endedAt: true, kind: true },
      });
      
      // Create a set of already-processed minute timestamps
      const processedMinutes = new Set<number>();
      console.log(`🔍 Found ${existingEntries.length} existing entries in rollup window`);
      for (const entry of existingEntries) {
        let current = new Date(entry.startedAt);
        const end = new Date(entry.endedAt);
        while (current < end) {
          processedMinutes.add(current.getTime());
          current = addMinutes(current, 1);
        }
      }
      console.log(`🔍 Total processed minutes to skip: ${processedMinutes.size}`);
      
      const minuteEntries: Array<{
        userId: string;
        startedAt: Date;
        endedAt: Date;
        hasActivity: boolean;
        isBreak?: boolean;
      }> = [];

      for (const bucket of minuteBuckets) {
        if (!isWithinCheckinWindow(bucket.start, rules)) continue;
        
        // Check activity using activeSeconds field (more accurate) or fallback to mouse/key
        const active = bucket.samples.some((s) => 
          (s.activeSeconds !== undefined && s.activeSeconds !== null && s.activeSeconds > 0) ||
          hasActivity(s.mouseDelta, s.keyCount)
        );
        
        // Check if this minute was already processed
        const alreadyProcessed = processedMinutes.has(bucket.start.getTime());
        
        // Find what kind of entry exists for this minute
        const existingEntry = existingEntries.find(e => {
          const eStart = new Date(e.startedAt).getTime();
          const eEnd = new Date(e.endedAt).getTime();
          const bStart = bucket.start.getTime();
          return eStart <= bStart && eEnd > bStart;
        });
        
        // Skip logic:
        // 1. If minute is already ACTIVE and current samples are also ACTIVE -> Skip (prevent reprocessing)
        // 2. If minute is already IDLE and current samples are also IDLE -> Skip (prevent reprocessing)
        // 3. If minute is ACTIVE but samples are IDLE -> Process (allow IDLE to replace ACTIVE after threshold)
        // 4. If minute is IDLE but samples are ACTIVE -> Process (allow real activity to replace IDLE)
        if (alreadyProcessed && existingEntry) {
          const existingIsActive = existingEntry.kind === 'ACTIVE';
          const currentIsActive = active;
          
          // Skip only if both are same kind (no state change)
          if (existingIsActive === currentIsActive) {
            console.log(`⏭️ Skipping already-processed ${existingEntry.kind} minute: ${bucket.start.toISOString()}`);
            continue;
          }
          
          // ✅ Allow IDLE to replace ACTIVE - applyIdleThreshold will handle the threshold logic
          // No need to check consecutive idle minutes here
        }
        
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

        minuteEntries.push({
          userId,
          startedAt: bucket.start,
          endedAt: bucket.end,
          hasActivity: active,
          isBreak: false,
        });
      }

      const entries = this.applyIdleThreshold(minuteEntries, rules.idleThresholdSeconds);
      const merged = this.mergeContiguous(entries);

      await this.prisma.$transaction(async (tx) => {
        if (merged.length === 0) return;

        for (const newEntry of merged) {
          const entryWithProject = { ...newEntry, projectId: projectId || null };
          
          // Delete any overlapping entries of same kind before inserting
          const overlappingEntries = await tx.timeEntry.findMany({
            where: {
              userId,
              source: 'AUTO',
              kind: newEntry.kind,
              startedAt: { lt: newEntry.endedAt },
              endedAt: { gt: newEntry.startedAt },
            },
          });

          if (overlappingEntries.length > 0) {
            // Delete all overlapping entries
            await tx.timeEntry.deleteMany({
              where: {
                id: { in: overlappingEntries.map(e => e.id) },
              },
            });
            console.log(`🗑️ Deleted ${overlappingEntries.length} overlapping ${newEntry.kind} entries`);
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
              console.log(`⏭️ IDLE fully covered by ACTIVE, skipping: ${newEntry.startedAt.toISOString()}`);
              continue;
            }
          }

          // Log conflicts before processing
          if (trueConflicts.length > 0) {
            console.log(`🔍 Conflict detected for ${newEntry.kind} ${newEntry.startedAt.toISOString()}-${newEntry.endedAt.toISOString()}:`);
            for (const c of trueConflicts) {
              console.log(`   - Existing ${c.kind} ${c.startedAt.toISOString()}-${c.endedAt.toISOString()}`);
            }
          }

          // Collect all operations to execute in batch
          const toDelete: bigint[] = [];
          const toCreate: any[] = [];

          for (const conflict of trueConflicts) {
            toDelete.push(conflict.id);
            console.log(`   🗑️ Deleting: ${conflict.kind} ${conflict.startedAt.toISOString()}-${conflict.endedAt.toISOString()}`);

            if (conflict.startedAt < newEntry.startedAt) {
              const splitEntry = {
                userId,
                startedAt: conflict.startedAt,
                endedAt: newEntry.startedAt,
                kind: conflict.kind,
                source: 'AUTO',
              };
              toCreate.push(splitEntry);
              console.log(`   ➕ Creating split (before): ${conflict.kind} ${conflict.startedAt.toISOString()}-${newEntry.startedAt.toISOString()}`);
            }

            if (conflict.endedAt > newEntry.endedAt) {
              const splitEntry = {
                userId,
                startedAt: newEntry.endedAt,
                endedAt: conflict.endedAt,
                kind: conflict.kind,
                source: 'AUTO',
              };
              toCreate.push(splitEntry);
              console.log(`   ➕ Creating split (after): ${conflict.kind} ${newEntry.endedAt.toISOString()}-${conflict.endedAt.toISOString()}`);
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

          // Insert new entry
          await tx.timeEntry.create({ data: entryWithProject });
          const duration = Math.floor((newEntry.endedAt.getTime() - newEntry.startedAt.getTime()) / 60000);
          console.log(`✅ Inserted ${newEntry.kind}: ${newEntry.startedAt.toISOString()}-${newEntry.endedAt.toISOString()} (${duration}min)`);
        }
      }, { timeout: 15000 });

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

    for (let i = 0; i < minuteEntries.length; i++) {
      const entry = minuteEntries[i];

      if (entry.hasActivity) {
        if (pendingIdleEntries.length > 0) {
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

        if (consecutiveIdleCount > idleThresholdMinutes) {
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
            const idleEntries = pendingIdleEntries.map(e => ({ ...e, kind: 'IDLE' as const }));
            entries.push(...idleEntries);
            pendingIdleEntries = [];
          }
        }
      }
    }

    if (pendingIdleEntries.length > 0) {
      entries.push(...pendingIdleEntries);
    }

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
