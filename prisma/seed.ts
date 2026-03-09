import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.horse.createMany({
    data: [
      {
        name: 'Sir Rocket',
        birthDate: new Date(2016, 4, 2),
        gender: 'Male',
        color: 'Palomino',
        status: 'Active',
      },
      {
        name: 'Macky Moon',
        birthDate: new Date(2015, 2, 8),
        gender: 'Female',
        color: 'Gray',
        status: 'For Sale',
      },
      {
        name: 'Starliver',
        birthDate: new Date(2013, 11, 12),
        gender: 'Male',
        color: 'Black',
        status: 'Deceased',
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seeding complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
