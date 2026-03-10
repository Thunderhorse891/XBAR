import sqlite3 from "sqlite3";
const databaseName = "xbar.db";
export const db = sqlite3.open(databaseName);
export default db;