import sqlite3 from "sqlite3";
type Database = return typeof sqlite3;

const createDbSession =(): Database => {
  return sqlite3.open('./xbar.db');
};

export default createDbSession;

export type { Database };
