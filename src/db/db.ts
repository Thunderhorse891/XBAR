import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'database/xbar.db');

export type DatabaseConnection = Database.Database;

export const createDbSession = (): DatabaseConnection => new Database(dbPath);

export default createDbSession;
