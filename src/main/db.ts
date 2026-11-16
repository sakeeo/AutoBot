import Database from 'better-sqlite3'

export type Db = Database.Database

const MIGRATIONS: string[] = [
  `
  CREATE TABLE files (
    file TEXT PRIMARY KEY,
    mtime_ms REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'indexed',
    reason TEXT
  );
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX chunks_file ON chunks(file);
  CREATE VIRTUAL TABLE chunks_fts USING fts5(text, tokenize = 'unicode61 remove_diacritics 2');
  CREATE TABLE message_log (
    message_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    top_score REAL,
    sources TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE cooldowns (
    chat_id TEXT PRIMARY KEY,
    last_at INTEGER NOT NULL
  );
  `,
  `ALTER TABLE message_log ADD COLUMN text TEXT;`,
  `
  CREATE TABLE brand_versions (
    version INTEGER PRIMARY KEY,
    json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE brand_draft (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    name TEXT NOT NULL,
    price REAL,
    description TEXT NOT NULL DEFAULT '',
    checkout_url TEXT,
    suitable_for TEXT NOT NULL DEFAULT '',
    stock TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX products_file ON products(file);
  `
]

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}
