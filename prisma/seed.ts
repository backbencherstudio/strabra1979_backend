import * as bcrypt from 'bcrypt';
import { PrismaClient, UserStatus } from './generated/client';
import { Role } from '../src/common/guard/role/role.enum';
import appConfig from '../src/config/app.config';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = appConfig().database.url;

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  const roles = [
    Role.ADMIN,
    Role.PROPERTY_MANAGER,
    Role.AUTHORIZED_VIEWER,
    Role.OPERATIONAL,
  ];

  const password = await bcrypt.hash('12345678', 10);

  for (const role of roles) {
    const email = `${role.toLowerCase()}@gmail.com`;

    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      console.log(`✅ ${role} already exists`);
      continue;
    }

    await prisma.user.create({
      data: {
        email,
        username: role.toLowerCase(),
        password,
        role,
        status: UserStatus.ACTIVE,
        approved_at: new Date(),
        approved_by: 'SYSTEM',
      },
    });

    console.log(`🚀 Created ${role} user`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
