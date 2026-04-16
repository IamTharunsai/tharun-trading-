import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';

const prisma = new PrismaClient();

async function main() {
  // Delete existing users
  await prisma.user.deleteMany();

  // Create the owner user with the credentials from frontend
  const passwordHash = await bcrypt.hash('Tharunsai@2081as', 12);
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

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
