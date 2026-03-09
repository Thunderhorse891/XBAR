import Database from 'better-sqlite3';
import path from 'path';
import { Horse } from '@/types/horse';

const dbPath = path.resolve(__dirname, '../../database/xbar.db');
const db = new Database(dbPath);

// Initialize schema if not exists
db.prepare(
  `CREATE TABLE IF NOT EXISTS horses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    breed TEXT,
    age INTEGER,
    gender TEXT,
    microchip TEXT,
    owner TEXT,
    color TEXT,
    status TEXT,
    birthDate TEXT,
    medicalNotes TEXT,
    lastVetVisit TEXT
  )`
).run();

export async function saveHorsesToDB(horses: Horse[]) {
  const insert = db.prepare(`
    INSERT INTO horses (name, breed, age, gender, microchip, owner, color, status)
    VALUES (@name, @breed, @age, @gender, @microchipId, @owner, @color, @status)
  `);

  const insertMany = db.transaction((records: Horse[]) => {
    for (const record of records) {
      insert.run(record);
    }
  });

  insertMany(horses);
}

export function getAllHorses(): Horse[] {
  return db.prepare('SELECT * FROM horses').all() as Horse[];
}

export function updateHorseInDB(id: string, updates: Partial<Horse>) {
  const fields = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  db.prepare(`UPDATE horses SET ${fields} WHERE id = @id`).run({ ...updates, id });
}

export default db;
