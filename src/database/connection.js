import Database from "better-sqlite3";

const db = new Database(process.env.MEXCBOT_DB_PATH ?? "./data/tradingbot.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export default db;
