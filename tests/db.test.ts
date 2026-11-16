import { describe, it, expect } from 'vitest'
import { openDb } from '../src/main/db'

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
