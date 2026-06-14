import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.growthSettings.upsert({
    where: { id: 'global' },
    update: { globalEmergencyStop: false },
    create: { id: 'global', globalEmergencyStop: false }
  });
  console.log("Engine is now ON (globalEmergencyStop = false)");
}
main().catch(console.error).finally(() => prisma.$disconnect());
