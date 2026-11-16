import { randomBytes } from 'node:crypto'
import type { Db } from '../db'
import type { Audience, BContact, Campaign, CampaignKind, CampaignStatus, ContactStatus, SendStatus, SuppressReason } from '../../shared/broadcast'
import { hashNumber, normalizePhone, numberFromJid } from './identity'
import { startOfLocalDay, localDay } from './limits'
import type { Outcome } from './breaker'

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

  createImport(e: { sourceNote: string; total: number; valid: number }): number {
    const now = this.clock.now()
    const r = this.db
      .prepare('INSERT INTO broadcast_imports(source_note, attested_at, total, valid, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(e.sourceNote, now, e.total, e.valid, now)
    return Number(r.lastInsertRowid)
  }

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

  // ---- campaigns and the send queue ----

  private toCampaign = (r: {
    id: number; name: string; kind: CampaignKind; template: string; status: CampaignStatus; pause_reason: string | null
    created_at: number; started_at: number | null; audience: Audience; not_before: number | null
  }): Campaign => ({
    id: r.id, name: r.name, kind: r.kind, template: r.template, status: r.status, pauseReason: r.pause_reason,
    createdAt: r.created_at, startedAt: r.started_at, audience: r.audience, notBefore: r.not_before
  })

  createCampaign(c: { name: string; kind: CampaignKind; template: string; audience: Audience; notBefore?: number | null }): Campaign {
    const r = this.db
      .prepare('INSERT INTO broadcast_campaigns(name, kind, template, status, audience, not_before, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.name, c.kind, c.template, 'draf', c.audience, c.notBefore ?? null, this.clock.now())
    return this.getCampaign(Number(r.lastInsertRowid))!
  }

  getCampaign(id: number): Campaign | null {
    const r = this.db.prepare('SELECT * FROM broadcast_campaigns WHERE id = ?').get(id)
    return r ? this.toCampaign(r as Parameters<typeof this.toCampaign>[0]) : null
  }

  listCampaigns(): Campaign[] {
    return (this.db.prepare('SELECT * FROM broadcast_campaigns ORDER BY id DESC').all() as Parameters<typeof this.toCampaign>[0][]).map(this.toCampaign)
  }

  setCampaignStatus(id: number, status: CampaignStatus, pauseReason?: string): void {
    this.db
      .prepare(
        `UPDATE broadcast_campaigns SET status = ?, pause_reason = ?,
           started_at = CASE WHEN ? = 'berjalan' AND started_at IS NULL THEN ? ELSE started_at END WHERE id = ?`
      )
      .run(status, status === 'dijeda' ? pauseReason ?? null : null, status, this.clock.now(), id)
  }

  runningCampaign(): Campaign | null {
    const r = this.db.prepare("SELECT * FROM broadcast_campaigns WHERE status = 'berjalan' ORDER BY id LIMIT 1").get()
    return r ? this.toCampaign(r as Parameters<typeof this.toCampaign>[0]) : null
  }

  nextScheduled(now: number): Campaign | null {
    const r = this.db
      .prepare("SELECT * FROM broadcast_campaigns WHERE status = 'terjadwal' AND (not_before IS NULL OR not_before <= ?) ORDER BY id LIMIT 1")
      .get(now)
    return r ? this.toCampaign(r as Parameters<typeof this.toCampaign>[0]) : null
  }

  /** Who a campaign is aimed at, before any send-time rule. A confirmation targets people who have not confirmed yet. */
  audienceContacts(kind: CampaignKind, audience: Audience): BContact[] {
    let rows: Row[]
    if (kind === 'konfirmasi') {
      rows = this.db
        .prepare(
          `SELECT * FROM broadcast_contacts c WHERE c.source = 'impor' AND c.status = 'menunggu_persetujuan'
             AND NOT EXISTS (SELECT 1 FROM broadcast_sends s WHERE s.contact_id = c.id AND s.status = 'terkirim') ORDER BY c.id`
        )
        .all() as Row[]
    } else {
      const sources = audience === 'chat' ? ['chat'] : audience === 'impor' ? ['impor'] : ['chat', 'impor']
      rows = this.db
        .prepare(`SELECT * FROM broadcast_contacts WHERE status = 'aktif' AND source IN (${sources.map(() => '?').join(',')}) ORDER BY id`)
        .all(...sources) as Row[]
    }
    return rows.map(toContact)
  }

  sendCount(campaignId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM broadcast_sends WHERE campaign_id = ?').get(campaignId) as { n: number }).n
  }

  /** One queued send per recipient; calling it again adds nobody twice. */
  enqueue(campaignId: number): number {
    const c = this.getCampaign(campaignId)
    if (!c) return 0
    const now = this.clock.now()
    const ins = this.db.prepare("INSERT INTO broadcast_sends(campaign_id, contact_id, status, created_at) VALUES (?, ?, 'antre', ?)")
    const has = this.db.prepare('SELECT 1 FROM broadcast_sends WHERE campaign_id = ? AND contact_id = ?')
    let n = 0
    this.db.transaction(() => {
      for (const ct of this.audienceContacts(c.kind, c.audience)) {
        if (has.get(campaignId, ct.id)) continue
        ins.run(campaignId, ct.id, now)
        n++
      }
    })()
    return n
  }

  nextQueued(campaignId: number): { sendId: number; contact: BContact } | null {
    const r = this.db
      .prepare(
        `SELECT s.id AS send_id, c.* FROM broadcast_sends s JOIN broadcast_contacts c ON c.id = s.contact_id
         WHERE s.campaign_id = ? AND s.status = 'antre' ORDER BY s.id LIMIT 1`
      )
      .get(campaignId) as (Row & { send_id: number }) | undefined
    return r ? { sendId: r.send_id, contact: toContact(r) } : null
  }

  recordSend(sendId: number, r: { status: Exclude<SendStatus, 'antre'>; reason?: string; waId?: string | null; at: number }): void {
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE broadcast_sends SET status = ?, reason = ?, wa_id = ?, sent_at = ? WHERE id = ?')
        .run(r.status, r.reason ?? null, r.waId ?? null, r.status === 'terkirim' ? r.at : null, sendId)
      if (r.status === 'terkirim')
        this.db
          .prepare('UPDATE broadcast_contacts SET last_sent_at = ?, sent_count = sent_count + 1 WHERE id = (SELECT contact_id FROM broadcast_sends WHERE id = ?)')
          .run(r.at, sendId)
    })()
  }

  skipRemaining(campaignId: number, reason: string): void {
    this.db.prepare("UPDATE broadcast_sends SET status = 'dilewati', reason = ? WHERE campaign_id = ? AND status = 'antre'").run(reason, campaignId)
  }

  progress(campaignId: number): Record<SendStatus, number> {
    const out: Record<SendStatus, number> = { antre: 0, terkirim: 0, gagal: 0, dilewati: 0 }
    for (const r of this.db.prepare('SELECT status, COUNT(*) AS n FROM broadcast_sends WHERE campaign_id = ? GROUP BY status').all(campaignId) as { status: SendStatus; n: number }[])
      out[r.status] = r.n
    return out
  }

  /** Every limit is counted from what was really sent, so a restart cannot reset it. */
  counters(now: number, timezone: string): {
    sentToday: number; sentThisHour: number; newToday: number; sendDays: string[]; lastSentAt: number | null
  } {
    const sent = (this.db.prepare("SELECT sent_at FROM broadcast_sends WHERE status = 'terkirim' ORDER BY sent_at").all() as { sent_at: number }[]).map((r) => r.sent_at)
    const dayStart = startOfLocalDay(now, timezone)
    const firstSends = this.db
      .prepare("SELECT MIN(sent_at) AS m FROM broadcast_sends WHERE status = 'terkirim' GROUP BY contact_id")
      .all() as { m: number }[]
    return {
      sentToday: sent.filter((t) => t >= dayStart).length,
      sentThisHour: sent.filter((t) => t > now - 3_600_000).length,
      newToday: firstSends.filter((r) => r.m >= dayStart).length,
      sendDays: [...new Set(sent.map((t) => localDay(t, timezone)))],
      lastSentAt: sent.length ? sent[sent.length - 1] : null
    }
  }

  contactHistory(contactId: number, now: number): { lastSentAt: number | null; sentLast30d: number; neverSent: boolean } {
    const r = this.db
      .prepare(
        `SELECT MAX(sent_at) AS last, COUNT(*) AS total, SUM(CASE WHEN sent_at >= ? THEN 1 ELSE 0 END) AS recent
         FROM broadcast_sends WHERE contact_id = ? AND status = 'terkirim'`
      )
      .get(now - 30 * 86_400_000, contactId) as { last: number | null; total: number; recent: number | null }
    return { lastSentAt: r.last, sentLast30d: r.recent ?? 0, neverSent: r.total === 0 }
  }

  /** Has this person ever been sent a broadcast or a confirmation? */
  wasSentTo(key: Key): boolean {
    const c = this.findContact(key)
    if (!c) return false
    return !!this.db.prepare("SELECT 1 FROM broadcast_sends WHERE contact_id = ? AND status = 'terkirim' LIMIT 1").get(c.id)
  }

  recentOutcomes(limit: number): Outcome[] {
    const rows = this.db
      .prepare(
        `SELECT s.status, COALESCE(s.sent_at, s.created_at) AS at, k.kind AS kind, c.source AS source
         FROM broadcast_sends s JOIN broadcast_campaigns k ON k.id = s.campaign_id JOIN broadcast_contacts c ON c.id = s.contact_id
         WHERE s.status IN ('terkirim', 'gagal') ORDER BY s.id DESC LIMIT ?`
      )
      .all(limit) as { status: string; at: number; kind: CampaignKind; source: 'chat' | 'impor' }[]
    return rows.reverse().map((r) => ({ at: r.at, ok: r.status === 'terkirim', kind: r.kind, toNonChat: r.source === 'impor' }))
  }

  addEvent(kind: 'optout' | 'complaint', at: number): void {
    this.db.prepare('INSERT INTO broadcast_events(kind, at) VALUES (?, ?)').run(kind, at)
  }

  eventsSince(kind: 'optout' | 'complaint', since: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM broadcast_events WHERE kind = ? AND at >= ?').get(kind, since) as { n: number }).n
  }

  /** Imported contacts who answered after being messaged. */
  repliesFromImported(): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM broadcast_contacts c WHERE c.source = 'impor' AND c.last_inbound_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM broadcast_sends s WHERE s.contact_id = c.id AND s.status = 'terkirim' AND s.sent_at <= c.last_inbound_at)`
        )
        .get() as { n: number }
    ).n
  }

  // ---- small state, lists and report rows ----

  getState(k: string): string | null {
    const r = this.db.prepare('SELECT v FROM broadcast_state WHERE k = ?').get(k) as { v: string } | undefined
    return r ? r.v : null
  }

  setState(k: string, v: string): void {
    this.db.prepare('INSERT INTO broadcast_state(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v)
  }

  countByStatus(): Record<ContactStatus, number> {
    const out: Record<ContactStatus, number> = { aktif: 0, menunggu_persetujuan: 0, tidak_aktif: 0 }
    for (const r of this.db.prepare('SELECT status, COUNT(*) AS n FROM broadcast_contacts GROUP BY status').all() as { status: ContactStatus; n: number }[])
      out[r.status] = r.n
    return out
  }

  listContacts(f: { status?: ContactStatus; limit?: number } = {}): BContact[] {
    const rows = f.status
      ? (this.db.prepare('SELECT * FROM broadcast_contacts WHERE status = ? ORDER BY id DESC LIMIT ?').all(f.status, f.limit ?? 500) as Row[])
      : (this.db.prepare('SELECT * FROM broadcast_contacts ORDER BY id DESC LIMIT ?').all(f.limit ?? 500) as Row[])
    return rows.map(toContact)
  }

  reportRows(campaignId: number): { number: string | null; name: string; status: SendStatus; reason: string | null; at: number | null }[] {
    return this.db
      .prepare(
        `SELECT c.number AS number, c.name AS name, s.status AS status, s.reason AS reason, s.sent_at AS at
         FROM broadcast_sends s JOIN broadcast_contacts c ON c.id = s.contact_id WHERE s.campaign_id = ? ORDER BY s.id`
      )
      .all(campaignId) as { number: string | null; name: string; status: SendStatus; reason: string | null; at: number | null }[]
  }
}
