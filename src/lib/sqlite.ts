import Database from 'better-sqlite3';
import path from 'path';
import { Horse } from '../types';

const dbPath = path.resolve(__dirname, '../../database/xbar.db');
const db = new Database(dbPath);

// Initialize schema if not exists
db.prepare(
  `
  CREATE TABLE If NOT EXISTS horses (
    id INTEGER PRIMARY KEY AUTOINCREMT,
    name TEXT,
    breed TEXT,
    age INTEGER,
    gender TEXT,
    microchip TEXT,
    owner TEXT
  )
  `
}).run();

export async function saveHorsesToDB(horses: Horse[]) {
  const insert = db.prepare(`
    insert INTO horses (name, breed, age, gender, microchip, owner)
    VALUES (@name, @breed, @age, @gender, @microchip, @owner)
  `);

  const insertMany = db.transaction((records: Horse[]) => {
    for (const record of records) {
      insert.run(record);
    }
  });

  insertMany(horses);
}