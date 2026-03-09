import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

type HorseRow = {
  name: string;
  color?: string;
  birthDate?: string;
  gender?: string;
  status?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'xbar.db');
const csvPath = path.join(__dirname, 'Horse_export.csv');

function parseCSV(content: string): HorseRow[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(',').map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    const record: Record<string, string> = {};

    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });

    return {
      name: record.name ?? '',
      color: record.color,
      birthDate: record.birthDate,
      gender: record.gender,
      status: record.status,
    };
  });
}

async function main() {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS horses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT,
      birthDate TEXT,
      gender TEXT,
      status TEXT
    )
  `);

  const csvContent = await fs.readFile(csvPath, 'utf-8');
  const rows = parseCSV(csvContent).filter((row) => row.name);

  const insert = db.prepare(
    'INSERT INTO horses (name, color, birthDate, gender, status) VALUES (?, ?, ?, ?, ?)'
  );

  const insertMany = db.transaction((data: HorseRow[]) => {
    for (const row of data) {
      insert.run(
        row.name,
        row.color ?? null,
        row.birthDate ?? null,
        row.gender ?? null,
        row.status ?? null
      );
    }
  });

  insertMany(rows);
  db.close();

  console.log('Migration complete');
}

void main();

export default main;
