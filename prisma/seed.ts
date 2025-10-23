import { Prisma } from \"prisma/client\";

const prisma = new Prisma();

async function main() {
  await prisma.horse.create({
    name: "Sir Rocket",
    birthDate: new Date(2016, 4, 2),
    gender: "Mare",
    color: "Palomino",
    status: "Active"
  });

  await prisma.horse.create({
    name: "Macky Moon",
    birthDate: new Date(2015, 2, 8),
    gender: "Female",
    color: "Gray",
    status: "For Sale"
  });

  await prisma.horse.create({
    name: "Starliver",
    birthDate: new Date(2013, 12, 12),
    gender: "Male",
    color: "Black",
    status: "Deceased"
  });

  console.log("Seeding complete.");
}

main();
