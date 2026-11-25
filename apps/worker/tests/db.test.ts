import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db'

describe('openDb', () => {
  it('creates an fts5 table that matches inserted text', () => {
    const db = openDb(':memory:')
    db.prepare('INSERT INTO chunks_fts(text) VALUES (?)').run('Harga kopi susu Rp25.000')
    const rows = db.prepare("SELECT text FROM chunks_fts WHERE chunks_fts MATCH 'harga'").all()
    expect(rows).toHaveLength(1)
  })

  it('creates the supporting tables', () => {
    const db = openDb(':memory:')
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name)
    for (const t of ['chunks', 'files', 'message_log', 'cooldowns']) expect(names).toContain(t)
  })
})

describe('broadcast removal (migration 12)', () => {
  it('leaves no broadcast_* table on a fresh database, but keeps the tables the bot still needs', () => {
    const db = openDb(':memory:')
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name)
    expect(names.filter((n) => n.startsWith('broadcast_'))).toEqual([])
    for (const keep of ['messages', 'message_log', 'turns', 'contacts', 'handoffs', 'events', 'cooldowns', 'contact_memory', 'products', 'chunks'])
      expect(names, keep).toContain(keep)
    // alt_jid (lid -> phone link) survives: eraseCustomer and the Pesan page rely on it
    const cols = (db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('alt_jid')
  })
})
