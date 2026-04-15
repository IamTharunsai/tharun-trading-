import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Handle disconnection
process.on('exit', async () => {
  await prisma.$disconnect();
});
