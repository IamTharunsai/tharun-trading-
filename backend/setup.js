#!/usr/bin/env node

/**
 * APEX TRADER Setup Script
 * Initializes the database and seeds test data
 */

const { execSync } = require('child_process');
const path = require('path');

const commands = [
  { name: 'Generating Prisma Client', cmd: 'npx prisma generate --schema=./prisma/schema.prisma' },
  { name: 'Creating Database', cmd: 'npx prisma migrate dev --name init --skip-generate --schema=./prisma/schema.prisma' },
  { name: 'Seeding Test User', cmd: 'npx ts-node ./prisma/seed.ts' }
];

async function runSetup() {
  console.log('\n🚀 APEX TRADER Backend Setup\n');
  
  for (const { name, cmd } of commands) {
    try {
      console.log(`\n⏳ ${name}...`);
      execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
      console.log(`✅ ${name} completed\n`);
    } catch (error) {
      console.error(`❌ ${name} failed`);
      console.error(`Command: ${cmd}`);
      process.exit(1);
    }
  }
  
  console.log('\n✅ Setup complete! You can now run: npm run dev\n');
}

runSetup().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
