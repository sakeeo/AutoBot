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
  `,
  `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_id TEXT UNIQUE,
    chat_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    text TEXT NOT NULL,
    is_group INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_chat ON messages(chat_id, id);
  `,
  `
  CREATE TABLE broadcast_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE broadcast_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_note TEXT NOT NULL,
    attested_at INTEGER NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    valid INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE broadcast_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE,
    jid TEXT UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    vars TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    last_inbound_at INTEGER,
    last_sent_at INTEGER,
    sent_count INTEGER NOT NULL DEFAULT 0,
    import_id INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE broadcast_suppress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT,
    jid TEXT,
    hash TEXT,
    jid_hash TEXT,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX broadcast_suppress_number ON broadcast_suppress(number);
  CREATE INDEX broadcast_suppress_jid ON broadcast_suppress(jid);
  CREATE INDEX broadcast_suppress_hash ON broadcast_suppress(hash);
  CREATE INDEX broadcast_suppress_jid_hash ON broadcast_suppress(jid_hash);
  CREATE TABLE broadcast_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    template TEXT NOT NULL,
    status TEXT NOT NULL,
    pause_reason TEXT,
    audience TEXT NOT NULL,
    not_before INTEGER,
    created_at INTEGER NOT NULL,
    started_at INTEGER
  );
  CREATE TABLE broadcast_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    scheduled_for INTEGER,
    sent_at INTEGER,
    wa_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX broadcast_sends_campaign ON broadcast_sends(campaign_id, status);
  CREATE INDEX broadcast_sends_sent ON broadcast_sends(sent_at);
  CREATE INDEX broadcast_sends_contact ON broadcast_sends(contact_id);
  `,
  `
  CREATE TABLE broadcast_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX broadcast_events_kind ON broadcast_events(kind, at);
  `,
  // A lid chat id carries no phone number; keep the phone jid WhatsApp reports alongside it.
  `ALTER TABLE messages ADD COLUMN alt_jid TEXT;`,
  // Recipients picked by hand for a campaign (JSON array of contact ids); NULL means everyone in the audience.
  `ALTER TABLE broadcast_campaigns ADD COLUMN contact_ids TEXT;`,
  // What the bot remembers about a customer across conversations: a rolling summary and a few short facts.
  `
  CREATE TABLE contact_memory (
    chat_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL DEFAULT '',
    summarized_up_to INTEGER NOT NULL DEFAULT 0,
    facts_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
  `,
  // The broadcast feature was removed. Earlier migrations stay as they were; this drops what they created.
  `
  DROP TABLE IF EXISTS broadcast_events;
  DROP TABLE IF EXISTS broadcast_sends;
  DROP TABLE IF EXISTS broadcast_campaigns;
  DROP TABLE IF EXISTS broadcast_suppress;
  DROP TABLE IF EXISTS broadcast_contacts;
  DROP TABLE IF EXISTS broadcast_imports;
  DROP TABLE IF EXISTS broadcast_state;
  `,
  // Instance flags (the bot switch) and the log of system messages (verification codes, notices): time and kind only, never the text.
  `
  CREATE TABLE instance_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE system_send_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL
  );
  CREATE INDEX system_send_log_at ON system_send_log(at);
  `,
  // Google Sheets sources and the checkout domains the owner approved. The service account key lives in the secret store, never here.
  `
  CREATE TABLE knowledge_sources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'gsheet',
    name TEXT NOT NULL,
    spreadsheet_id TEXT NOT NULL,
    gid INTEGER NOT NULL,
    tab_title TEXT NOT NULL,
    range TEXT,
    role TEXT NOT NULL,
    mapping_json TEXT NOT NULL DEFAULT '{}',
    interval_min INTEGER NOT NULL DEFAULT 15,
    enabled INTEGER NOT NULL DEFAULT 1,
    file TEXT NOT NULL UNIQUE,
    content_hash TEXT,
    row_count INTEGER NOT NULL DEFAULT 0,
    last_sync_at INTEGER,
    last_ok_at INTEGER,
    last_status TEXT NOT NULL DEFAULT 'never',
    last_error TEXT,
    last_summary TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    pending_json TEXT,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX knowledge_sources_tab ON knowledge_sources(spreadsheet_id, gid, IFNULL(range, ''));
  CREATE TABLE approved_domains (
    domain TEXT PRIMARY KEY,
    approved_at INTEGER NOT NULL,
    approved_by TEXT NOT NULL
  );
  `
]

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}
