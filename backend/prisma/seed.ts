import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';

const prisma = new PrismaClient();

/**
 * The owner password is never hard-coded in this file. It is read from the
 * OWNER_PASSWORD environment variable — the same variable the first-boot
 * bootstrap in src/utils/prisma.ts provisions the owner from.
 *
 * Fail closed: when OWNER_PASSWORD is unset or empty this throws, and main()
 * calls it before any database query, so a seed run can never delete the
 * existing users or (re)create the owner account with a known/default
 * password.
 */
export function requireOwnerPassword(env: NodeJS.ProcessEnv = process.env): string {
  const password = env.OWNER_PASSWORD;
  if (!password || password.trim() === '') {
    throw new Error(
      'OWNER_PASSWORD is not set or is empty. Refusing to seed: set OWNER_PASSWORD ' +
        'in the environment to the owner password to provision, then re-run the seed. ' +
        'No database changes were made.'
    );
  }
  return password;
}

async function main() {
  // Fail closed before touching the database (see requireOwnerPassword).
  const ownerPassword = requireOwnerPassword();

  // Delete existing users
  await prisma.user.deleteMany();

  // Create the owner user with the credentials from frontend
  const passwordHash = await bcrypt.hash(ownerPassword, 12);
  const secret = speakeasy.generateSecret({ name: 'APEX TRADER', issuer: 'ApexTrader' });

  const user = await prisma.user.create({
    data: {
      email: 'nandigam2081@gmail.com',
      passwordHash,
      totpSecret: secret.base32,
      totpEnabled: false, // Disable 2FA for now for testing
      lastLogin: new Date(),
      ipWhitelist: [],
    },
  });

  console.log('✅ Database seeded with test user');
  console.log('📧 Email:', user.email);
  console.log('🔑 User ID:', user.id);
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
