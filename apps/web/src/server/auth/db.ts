import Database from 'better-sqlite3'

export type AuthDb = Database.Database

const MIGRATIONS: string[] = [
  `
  -- The one owner. id is pinned to 1, so a second account cannot exist: creating it fails at the database.
  CREATE TABLE users (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    owner_phone TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    password_changed_at INTEGER NOT NULL,
    totp_secret_enc TEXT,                       -- NULL = must enrol again at the next login (after reset-totp)
    totp_last_step INTEGER NOT NULL DEFAULT 0   -- the last time step accepted; never accept it twice
  );
  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hmac TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    used_at INTEGER
  );
  -- Every cookie-borne credential is a row here, keyed by the SHA-256 of its token (the token itself is never stored).
  -- kind: owner (signed in) | setup (first-run wizard) | pending (password ok, waiting for TOTP) | reset (OTP ok, waiting for a new password)
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    reauth_at INTEGER,
    restricted INTEGER NOT NULL DEFAULT 0,      -- signed in with a recovery code: may only enrol a new TOTP
    data_enc TEXT,                              -- sealed JSON for the step in progress (e.g. a TOTP secret being enrolled)
    ip_hash TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_kind ON sessions(kind);
  CREATE TABLE setup_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_hmac TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    owner_phone TEXT,
    owner_phone_verified_at INTEGER,
    username TEXT,
    password_hash TEXT,
    totp_secret_enc TEXT,
    totp_verified_at INTEGER,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    recovery_hmacs TEXT                         -- JSON array of HMACs, set once the first TOTP code is accepted
  );
  CREATE TABLE otp_challenges (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    phone TEXT NOT NULL,
    code_hmac TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX otp_created ON otp_challenges(created_at);
  CREATE TABLE otp_failures (at INTEGER NOT NULL);
  CREATE TABLE throttle (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE rate_windows (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    via TEXT NOT NULL,                          -- web | server
    ip_hash TEXT,
    detail TEXT
  );
  CREATE INDEX audit_at ON audit_log(at);
  `
]

export function openAuthDb(path: string): AuthDb {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db
}
