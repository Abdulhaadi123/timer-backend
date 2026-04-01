const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testActivityRate() {
  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { email: 'test-misbah@dexterz.com' },
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`✅ Testing activity rate for: ${user.email}`);
    console.log(`User ID: ${user.id}\n`);

    // Get today's date (UTC midnight)
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Get all activity samples for today
    const samples = await prisma.activitySample.findMany({
      where: {
        userId: user.id,
        capturedAt: { gte: today },
      },
      select: {
        activeSeconds: true,
        capturedAt: true,
      },
      orderBy: { capturedAt: 'asc' },
    });

    console.log(`📊 Total Samples: ${samples.length}\n`);

    if (samples.length === 0) {
      console.log('⚠️ No samples found for today');
      return;
    }

    // Calculate activity rate
    let totalActiveSeconds = 0;
    let totalSampleSeconds = 0;
    let samplesWithData = 0;

    console.log('📋 Sample Details:');
    samples.forEach((sample, index) => {
      if (sample.activeSeconds != null) {
        totalActiveSeconds += sample.activeSeconds;
        totalSampleSeconds += 5; // Each sample is 5 seconds
        samplesWithData++;
        
        if (index < 10) { // Show first 10 samples
          console.log(`  Sample ${index + 1}: ${sample.activeSeconds}s active at ${sample.capturedAt.toISOString()}`);
        }
      }
    });

    if (samples.length > 10) {
      console.log(`  ... and ${samples.length - 10} more samples`);
    }

    console.log(`\n📈 Activity Rate Calculation:`);
    console.log(`  Samples with data: ${samplesWithData}`);
    console.log(`  Total Active Seconds: ${totalActiveSeconds}s`);
    console.log(`  Total Sample Seconds: ${totalSampleSeconds}s (${samplesWithData} samples × 5s)`);
    console.log(`  Formula: (${totalActiveSeconds} / ${totalSampleSeconds}) × 100`);
    
    const activityRate = totalSampleSeconds > 0 
      ? Math.round((totalActiveSeconds / totalSampleSeconds) * 100) 
      : 0;

    console.log(`\n✅ Activity Rate: ${activityRate}%`);

    // Show rating
    let rating = '';
    if (activityRate >= 80) rating = 'Excellent';
    else if (activityRate >= 70) rating = 'Good';
    else if (activityRate >= 60) rating = 'Average';
    else rating = 'Below Average';

    console.log(`📊 Rating: ${rating}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testActivityRate();
