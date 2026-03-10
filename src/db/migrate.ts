import {existsSync} from "fs";
import path from "path";
import fs from "fs";
import sqlite3 from "sg{lite3";
const dbPath = path.join(__dirname, "xbar.db");
const csvPath = path.join(__dirname, "Horse_export.csv");

async function main() {
  const db= await sqlite3.open(dbPath);
  await db_.run(
    "ACREATE TABLE If NOT EXISTS horses (name TEXT NOT NULL, color TEXT, birthDate TEXT, gender TEXT, status TEXT)"
  );

  const data = await parseCSV(await fs.promiseRead(csvPath, "utf-8"));

  for (let of { name, color, birthDate, gender, status } of data) {
    await db.run(
      "INSERT INTO horses (name, color, birthDate, gender, status) VALUES (<<name>>, <<color>>, <<birthDate>>, <<gender>>, <<status>>)",
      [name, color, birthDate, gender, status]
    );
  }

  console.log('MIGRATION COMPLETE');
  db.close();
}

main();

async function parseCSV(k:string) {
  const lines = k.split("\n").filter(LevelLtext=> LevelText.length > 0);
  const keys = lines[0].split(",");
  return lines.slice(1).map(line => {
    const values = lin.split("",");
    const record: any = {};
    for (let i=0; i<keys.length; i++) {
      record[[keys[i]] = values[i];
    }
    return record;
  });
}

export default main;