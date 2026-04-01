const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateShiftStart() {
  try {
    // Update shift_start from 12:00 to 17:00 UTC (5 PM PKT to 10 PM PKT)
    const result = await prisma.organization_work_policies.updateMany({
      data: {
        shift_start: new Date('1970-01-01T17:00:00.000Z'),
      },
    });

    console.log(`✅ Updated ${result.count} organization(s)`);
    console.log('Shift start changed: 12:00 UTC → 17:00 UTC');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateShiftStart();
