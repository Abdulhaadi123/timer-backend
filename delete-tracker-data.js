require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deleteTrackerData() {
  const email = 'tracker@dexterz.com';
  
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, fullName: true, email: true },
  });

  if (!user) {
    console.log('❌ User not found:', email);
    return;
  }

  console.log(`\n🔍 Found user: ${user.fullName} (${user.email})`);
  console.log(`\n📋 User ID: ${user.id}\n`);

  const screenshots = await prisma.screenshot.deleteMany({ where: { userId: user.id } });
  console.log(`\n✓ Deleted ${screenshots.count} screenshots`);

  const timeEntries = await prisma.timeEntry.deleteMany({ where: { userId: user.id } });
  console.log(`\n✓ Deleted ${timeEntries.count} time entries`);

  const samples = await prisma.activitySample.deleteMany({ where: { userId: user.id } });
  console.log(`\n✓ Deleted ${samples.count} activity samples`);

  const sessions = await prisma.deviceSession.deleteMany({ where: { userId: user.id } });
  console.log(`\n✓ Deleted ${sessions.count} device sessions`);

  console.log(`\n\n✅ All tracking data deleted for ${email}\n`);

  const verifyScreenshots = await prisma.screenshot.count({ where: { userId: user.id } });
  const verifyTimeEntries = await prisma.timeEntry.count({ where: { userId: user.id } });
  const verifySamples = await prisma.activitySample.count({ where: { userId: user.id } });
  const verifySessions = await prisma.deviceSession.count({ where: { userId: user.id } });

  console.log(`\n📊 Verification:`);
  console.log(`\n   Screenshots: ${verifyScreenshots}`);
  console.log(`\n   Time Entries: ${verifyTimeEntries}`);
  console.log(`\n   Activity Samples: ${verifySamples}`);
  console.log(`   Device Sessions: ${verifySessions}`);

  await prisma.$disconnect();
}

deleteTrackerData().catch(console.error);
