import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Attempting comprehensive database fix for users table...');
    try {
        // 1. Create UserRole enum
        console.log('Checking/Creating UserRole enum...');
        await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

        // 2. Add missing columns
        console.log('Adding missing columns...');
        const commands = [
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS role "UserRole" DEFAULT 'MEMBER';`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS screenshot_enabled BOOLEAN DEFAULT true;`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID;`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_checkin_start TEXT;`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_checkin_end TEXT;`,
            // Ensure org_id is there too
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID;`
        ];

        for (const cmd of commands) {
            try {
                await prisma.$executeRawUnsafe(cmd);
                console.log(`Success: ${cmd.split('ADD COLUMN')[0]}...`);
            } catch (e) {
                console.log(`Skipped or Error in: ${cmd}`);
            }
        }

        // 3. Add FKs
        console.log('Adding foreign key constraints...');
        const fkCommands = [
            `ALTER TABLE users ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;`,
            `ALTER TABLE users ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;`
        ];

        for (const fkCmd of fkCommands) {
            try {
                await prisma.$executeRawUnsafe(fkCmd);
                console.log('FK added successfully.');
            } catch (e) {
                console.log('FK skipped (may already exist).');
            }
        }

        console.log('Database fix completed successfully.');
    } catch (error) {
        console.error('Error during database fix:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
