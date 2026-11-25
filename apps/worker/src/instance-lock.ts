import Database from 'better-sqlite3'

export interface InstanceLock {
  release(): void
}

/**
 * Only one process may hold the WhatsApp session (a second one gets the session replaced and the bot goes quiet).
 * The lock is an exclusive SQLite transaction held open on a small dedicated file, so the operating system drops it
 * the moment the process dies: there is no stale lock file to clean up after a crash or a container restart.
 */
export function acquireInstanceLock(file: string): InstanceLock {
  let db: Database.Database | null = null
  try {
    db = new Database(file, { timeout: 0 })
    db.pragma('journal_mode = DELETE')
    db.exec('BEGIN EXCLUSIVE')
  } catch {
    try { db?.close() } catch { /* already closed */ }
    throw new Error('INSTANCE_ALREADY_RUNNING')
  }
  const held = db
  return {
    release() {
      try { held.exec('ROLLBACK') } catch { /* nothing to roll back */ }
      try { held.close() } catch { /* already closed */ }
    }
  }
}
