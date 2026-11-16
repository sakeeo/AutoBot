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
  `,
  `
  CREATE TABLE contacts (
    chat_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'bot',
    stage TEXT NOT NULL DEFAULT 'sapa',
    paused_until INTEGER,
    lead_json TEXT NOT NULL DEFAULT '{}',
    product_id TEXT,
    low_conf INTEGER NOT NULL DEFAULT 0,
    no_progress INTEGER NOT NULL DEFAULT 0,
    rule_counts TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX turns_chat ON turns(chat_id, id);
  CREATE TABLE handoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    type TEXT NOT NULL,
    product_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX events_chat ON events(chat_id, type);
  CREATE TABLE sent_messages (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
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
