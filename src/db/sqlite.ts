import Database from 'better-sqlite3';
import path from 'path';

const databaseName = path.resolve(process.cwd(), 'database/xbar.db');
export const db = new Database(databaseName);
export default db;
