import { randomBytes } from 'node:crypto'
import type { Db } from '../db'
import type { BContact, ContactStatus, SuppressReason } from '../../shared/broadcast'
import { hashNumber, normalizePhone, numberFromJid } from './identity'

interface Row {
  id: number; number: string | null; jid: string | null; name: string; vars: string; source: 'chat' | 'impor'
  status: ContactStatus; last_inbound_at: number | null; last_sent_at: number | null; sent_count: number; import_id: number | null
}
const toContact = (r: Row): BContact => ({
  id: r.id, number: r.number, jid: r.jid, name: r.name, vars: JSON.parse(r.vars) as Record<string, string>,
  source: r.source, status: r.status, lastInboundAt: r.last_inbound_at, lastSentAt: r.last_sent_at,
  sentCount: r.sent_count, importId: r.import_id
})

export interface Key { number?: string | null; jid?: string | null }

/** Contacts, the suppression list and (later) campaigns for broadcast. Numbers are always stored normalised. */
export class BroadcastStore {
  constructor(private db: Db, private clock: { now(): number }) {}

  salt(): string {
    const row = this.db.prepare("SELECT v FROM broadcast_state WHERE k = 'salt'").get() as { v: string } | undefined
    if (row) return row.v
    const salt = randomBytes(16).toString('hex')
    this.db.prepare("INSERT INTO broadcast_state(k, v) VALUES ('salt', ?)").run(salt)
    return salt
  }

  /** Every identifier we can derive for a person: their number, their jid, and the number inside the jid. */
  private ids(key: Key): { number: string | null; jid: string | null } {
    const jid = key.jid ?? null
    const number = (key.number ? normalizePhone(key.number) : null) ?? (jid ? numberFromJid(jid) : null)
    return { number, jid }
  }

  findContact(key: Key): BContact | null {
    const { number, jid } = this.ids(key)
    if (number) {
      const r = this.db.prepare('SELECT * FROM broadcast_contacts WHERE number = ?').get(number) as Row | undefined
      if (r) return toContact(r)
    }
    if (jid) {
      const r = this.db.prepare('SELECT * FROM broadcast_contacts WHERE jid = ?').get(jid) as Row | undefined
      if (r) return toContact(r)
    }
    return null
  }

  upsertContact(c: {
    number: string | null; jid: string | null; name?: string; vars?: Record<string, string>
    source: 'chat' | 'impor'; status: ContactStatus; importId?: number
  }): BContact {
    const { number, jid } = this.ids(c)
    const existing = this.findContact({ number, jid })
    const now = this.clock.now()
    if (!existing) {
      const r = this.db
        .prepare(
          `INSERT INTO broadcast_contacts(number, jid, name, vars, source, status, import_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(number, jid, c.name ?? '', JSON.stringify(c.vars ?? {}), c.source, c.status, c.importId ?? null, now)
      return toContact(this.db.prepare('SELECT * FROM broadcast_contacts WHERE id = ?').get(r.lastInsertRowid) as Row)
    }
    // Same person seen again: fill in what was missing, never downgrade status or source.
    const name = c.name && !existing.name ? c.name : existing.name
    const vars = { ...existing.vars, ...(c.vars ?? {}) }
    const fillNumber = existing.number ?? number
    const fillJid = existing.jid ?? jid
    try {
      this.db
        .prepare('UPDATE broadcast_contacts SET number = ?, jid = ?, name = ?, vars = ?, import_id = COALESCE(import_id, ?) WHERE id = ?')
        .run(fillNumber, fillJid, name, JSON.stringify(vars), c.importId ?? null, existing.id)
    } catch {
      // The missing identifier already belongs to another row; keep what we have.
      this.db
        .prepare('UPDATE broadcast_contacts SET name = ?, vars = ?, import_id = COALESCE(import_id, ?) WHERE id = ?')
        .run(name, JSON.stringify(vars), c.importId ?? null, existing.id)
    }
    return this.findContact({ number: fillNumber, jid: fillJid })!
  }

  setContactStatus(id: number, status: ContactStatus): void {
    this.db.prepare('UPDATE broadcast_contacts SET status = ? WHERE id = ?').run(status, id)
  }

  recordInbound(key: Key, at: number): BContact | null {
    const c = this.findContact(key)
    if (!c) return null
    const status: ContactStatus = c.status === 'menunggu_persetujuan' ? 'aktif' : c.status
    this.db
      .prepare('UPDATE broadcast_contacts SET last_inbound_at = MAX(COALESCE(last_inbound_at, 0), ?), status = ? WHERE id = ?')
      .run(at, status, c.id)
    return this.findContact({ number: c.number, jid: c.jid })
  }

  suppress(e: { number?: string | null; jid?: string | null; reason: SuppressReason }): void {
    const { number, jid } = this.ids(e)
    if (!number && !jid) return
    const salt = this.salt()
    const hash = number ? hashNumber(number, salt) : null
    const jidHash = jid ? hashNumber(jid, salt) : null
    const found = this.matchingRows(number, jid, hash, jidHash)
    if (found.length > 0) {
      this.db.prepare('UPDATE broadcast_suppress SET reason = ? WHERE id = ?').run(e.reason, found[0])
      return
    }
    this.db
      .prepare('INSERT INTO broadcast_suppress(number, jid, hash, jid_hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(number, jid, hash, jidHash, e.reason, this.clock.now())
  }

  private matchingRows(number: string | null, jid: string | null, hash: string | null, jidHash: string | null): number[] {
    const out = new Set<number>()
    const q = (col: string, v: string | null): void => {
      if (!v) return
      for (const r of this.db.prepare(`SELECT id FROM broadcast_suppress WHERE ${col} = ?`).all(v) as { id: number }[]) out.add(r.id)
    }
    q('number', number); q('jid', jid); q('hash', hash); q('jid_hash', jidHash)
    return [...out]
  }

  isSuppressed(key: Key): { reason: SuppressReason } | null {
    const { number, jid } = this.ids(key)
    const salt = this.salt()
    const ids = this.matchingRows(
      number, jid, number ? hashNumber(number, salt) : null, jid ? hashNumber(jid, salt) : null
    )
    if (ids.length === 0) return null
    const r = this.db.prepare('SELECT reason FROM broadcast_suppress WHERE id = ?').get(ids[0]) as { reason: SuppressReason }
    return { reason: r.reason }
  }

  unsuppress(key: Key): void {
    const { number, jid } = this.ids(key)
    const salt = this.salt()
    for (const id of this.matchingRows(number, jid, number ? hashNumber(number, salt) : null, jid ? hashNumber(jid, salt) : null))
      this.db.prepare('DELETE FROM broadcast_suppress WHERE id = ?').run(id)
  }

  listSuppressed(): { number: string | null; jid: string | null; reason: SuppressReason; at: number }[] {
    const rows = this.db.prepare('SELECT number, jid, reason, created_at FROM broadcast_suppress ORDER BY id').all() as {
      number: string | null; jid: string | null; reason: SuppressReason; created_at: number
    }[]
    return rows.map((r) => ({ number: r.number, jid: r.jid, reason: r.reason, at: r.created_at }))
  }

  /** Forget a person. Someone who opted out keeps only a salted hash so a re-import cannot message them again. */
  eraseContact(id: number): void {
    const row = this.db.prepare('SELECT * FROM broadcast_contacts WHERE id = ?').get(id) as Row | undefined
    if (!row) return
    const c = toContact(row)
    const was = this.isSuppressed({ number: c.number, jid: c.jid })
    const salt = this.salt()
    const jid = c.jid ?? (c.number ? `${c.number}@s.whatsapp.net` : null)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM broadcast_sends WHERE contact_id = ?').run(id)
      this.db.prepare('DELETE FROM broadcast_contacts WHERE id = ?').run(id)
      if (jid) {
        this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(jid)
        this.db.prepare('DELETE FROM message_log WHERE chat_id = ?').run(jid)
      }
      if (was) {
        const ids = this.matchingRows(c.number, c.jid, c.number ? hashNumber(c.number, salt) : null, c.jid ? hashNumber(c.jid, salt) : null)
        for (const rid of ids) this.db.prepare('DELETE FROM broadcast_suppress WHERE id = ?').run(rid)
        this.db
          .prepare('INSERT INTO broadcast_suppress(number, jid, hash, jid_hash, reason, created_at) VALUES (NULL, NULL, ?, ?, ?, ?)')
          .run(c.number ? hashNumber(c.number, salt) : null, c.jid ? hashNumber(c.jid, salt) : null, was.reason, this.clock.now())
      }
    })()
  }
}
