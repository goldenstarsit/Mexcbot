import Database from "better-sqlite3";

const db = new Database("./data/tradingbot.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export default db;
