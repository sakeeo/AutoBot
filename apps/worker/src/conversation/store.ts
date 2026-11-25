import type { Db } from '../db'
import type { Stage } from '@autobot/contracts/brand'

export type ContactStatus = 'bot' | 'menunggu_admin' | 'manusia'
export type TurnRole = 'user' | 'bot' | 'admin'
export type EventType = 'checkout_sent' | 'link_sent' | 'handoff' | 'lead_updated'

export interface ContactState {
  chatId: string
  status: ContactStatus
  stage: Stage
  pausedUntil: number | null
  lead: Record<string, string>
  productId: string | null
  lowConfidenceStreak: number
  turnsWithoutProgress: number
  ruleCounts: Record<string, number>
}

interface ContactRow {
  chat_id: string
  status: ContactStatus
  stage: Stage
  paused_until: number | null
  lead_json: string
  product_id: string | null
  low_conf: number
  no_progress: number
  rule_counts: string
}

export interface ContactMemory {
  summary: string
  facts: Record<string, string>
  /** Id of the last turn already folded into the summary. */
  summarizedUpTo: number
}

/** Tables that hold a customer's data, keyed by chat id. Anything new that stores customer data must be added here. */
const ERASABLE_TABLES = ['messages', 'message_log', 'turns', 'handoffs', 'contacts', 'events', 'cooldowns', 'contact_memory'] as const

const MAX_TURN_CHARS = 1000
const HOUR_MS = 3_600_000

export class ConversationStore {
  constructor(private db: Db, private clock: { now(): number }) {}

  appendTurn(chatId: string, role: TurnRole, text: string): void {
    this.db
      .prepare('INSERT INTO turns(chat_id, role, text, created_at) VALUES (?, ?, ?, ?)')
      .run(chatId, role, text.slice(0, MAX_TURN_CHARS), this.clock.now())
  }

  recentTurns(chatId: string, n: number): { role: TurnRole; text: string }[] {
    const rows = this.db
      .prepare('SELECT role, text FROM turns WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
      .all(chatId, n) as { role: TurnRole; text: string }[]
    return rows.reverse()
  }

  /** Turns not yet folded into the summary, oldest first; `limit` keeps only the newest ones. */
  unsummarizedTurns(chatId: string, limit = 1000): { id: number; role: TurnRole; text: string; at: number }[] {
    const rows = this.db
      .prepare(
        `SELECT id, role, text, created_at AS at FROM turns
         WHERE chat_id = ? AND id > COALESCE((SELECT summarized_up_to FROM contact_memory WHERE chat_id = ?), 0)
         ORDER BY id DESC LIMIT ?`
      )
      .all(chatId, chatId, limit) as { id: number; role: TurnRole; text: string; at: number }[]
    return rows.reverse()
  }

  getMemory(chatId: string): ContactMemory {
    const r = this.db.prepare('SELECT summary, summarized_up_to, facts_json FROM contact_memory WHERE chat_id = ?').get(chatId) as
      | { summary: string; summarized_up_to: number; facts_json: string }
      | undefined
    if (!r) return { summary: '', facts: {}, summarizedUpTo: 0 }
    let facts: Record<string, string> = {}
    try { facts = JSON.parse(r.facts_json) as Record<string, string> } catch { /* start clean */ }
    return { summary: r.summary, facts, summarizedUpTo: r.summarized_up_to }
  }

  setFacts(chatId: string, facts: Record<string, string>): void {
    this.db
      .prepare(
        `INSERT INTO contact_memory(chat_id, facts_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET facts_json = excluded.facts_json, updated_at = excluded.updated_at`
      )
      .run(chatId, JSON.stringify(facts), this.clock.now())
  }

  /** Without `summarizedUpTo` the fold marker stays where it is (an edit by hand does not move it). */
  setSummary(chatId: string, summary: string, summarizedUpTo?: number): void {
    this.db
      .prepare(
        `INSERT INTO contact_memory(chat_id, summary, summarized_up_to, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET summary = excluded.summary,
           summarized_up_to = COALESCE(?, summarized_up_to), updated_at = excluded.updated_at`
      )
      .run(chatId, summary, summarizedUpTo ?? 0, this.clock.now(), summarizedUpTo ?? null)
  }

  /** Forgets the customer's memory only; the messages stay. Turns already summarised stay out of the prompt. */
  clearMemory(chatId: string): void {
    const m = this.getMemory(chatId)
    this.db.prepare('DELETE FROM contact_memory WHERE chat_id = ?').run(chatId)
    if (m.summarizedUpTo > 0)
      this.db
        .prepare('INSERT INTO contact_memory(chat_id, summarized_up_to, updated_at) VALUES (?, ?, ?)')
        .run(chatId, m.summarizedUpTo, this.clock.now())
  }

  getState(chatId: string): ContactState {
    let row = this.db.prepare('SELECT * FROM contacts WHERE chat_id = ?').get(chatId) as ContactRow | undefined
    if (!row) return this.toState({ ...this.blank(chatId) })
    if (row.status !== 'bot' && row.paused_until !== null && row.paused_until <= this.clock.now()) {
      this.db.prepare("UPDATE contacts SET status = 'bot', paused_until = NULL WHERE chat_id = ?").run(chatId)
      row = { ...row, status: 'bot', paused_until: null }
    }
    return this.toState(row)
  }

  patchState(chatId: string, p: Partial<Omit<ContactState, 'chatId'>>): ContactState {
    const next = { ...this.getState(chatId), ...p }
    this.write(next)
    return this.getState(chatId)
  }

  mergeLead(chatId: string, updates: Record<string, string>): ContactState {
    const state = this.getState(chatId)
    const lead = { ...state.lead }
    for (const [k, v] of Object.entries(updates)) if (v && v.trim()) lead[k] = v.trim()
    return this.patchState(chatId, { lead })
  }

  pauseFor(chatId: string, status: Exclude<ContactStatus, 'bot'>, hours: number): void {
    this.patchState(chatId, { status, pausedUntil: this.clock.now() + hours * HOUR_MS })
  }

  /** A person takes the chat over from the app: the bot stays silent until `resume`, with no time limit. */
  takeOver(chatId: string): void {
    this.patchState(chatId, { status: 'manusia', pausedUntil: null })
    this.db
      .prepare("UPDATE handoffs SET status = 'resolved', resolved_at = ? WHERE chat_id = ? AND status = 'open'")
      .run(this.clock.now(), chatId)
  }

  /** Takes over or hands back many chats in one go. Only one-to-one customer chats count; the rest are skipped. */
  setHandlingBulk(chatIds: string[], to: 'manusia' | 'bot'): number {
    const ids = [...new Set(chatIds)].filter((id) => !id.endsWith('@g.us') && !id.endsWith('@broadcast'))
    this.db.transaction(() => {
      for (const id of ids) {
        if (to === 'manusia') this.takeOver(id)
        else this.resume(id)
      }
    })()
    return ids.length
  }

  /** True while the bot is switched off for this chat by a person, with no end time. */
  isTakenOver(chatId: string): boolean {
    const s = this.getState(chatId)
    return s.status === 'manusia' && s.pausedUntil === null
  }

  resume(chatId: string): void {
    this.patchState(chatId, { status: 'bot', pausedUntil: null })
  }

  isPaused(chatId: string): boolean {
    return this.getState(chatId).status !== 'bot'
  }

  recordEvent(chatId: string, type: EventType, productId?: string): void {
    this.db
      .prepare('INSERT INTO events(chat_id, type, product_id, created_at) VALUES (?, ?, ?, ?)')
      .run(chatId, type, productId ?? null, this.clock.now())
  }

  countEvents(chatId: string, type: EventType, productId?: string): number {
    const r = this.db
      .prepare('SELECT COUNT(*) c FROM events WHERE chat_id = ? AND type = ? AND (? IS NULL OR product_id = ?)')
      .get(chatId, type, productId ?? null, productId ?? null) as { c: number }
    return r.c
  }

  lastEventAt(chatId: string, type: EventType, productId?: string): number | null {
    const r = this.db
      .prepare(
        'SELECT MAX(created_at) t FROM events WHERE chat_id = ? AND type = ? AND (? IS NULL OR product_id = ?)'
      )
      .get(chatId, type, productId ?? null, productId ?? null) as { t: number | null }
    return r.t
  }

  recordHandoff(chatId: string, reason: string): number {
    return Number(
      this.db
        .prepare('INSERT INTO handoffs(chat_id, reason, created_at) VALUES (?, ?, ?)')
        .run(chatId, reason, this.clock.now()).lastInsertRowid
    )
  }

  /**
   * Erases everything the bot holds about one customer: the conversation, the log, the handling state and the memory.
   * A customer can be known by two jids (phone and lid); `messages.alt_jid` links them, so both forms are erased.
   * Returns every jid that was erased and the number of rows removed.
   */
  eraseCustomer(chatId: string): { jids: string[]; removed: number } {
    const jids = new Set<string>([chatId])
    const altOf = this.db.prepare('SELECT DISTINCT alt_jid AS j FROM messages WHERE chat_id = ? AND alt_jid IS NOT NULL')
    const chatsFor = this.db.prepare('SELECT DISTINCT chat_id AS j FROM messages WHERE alt_jid = ?')
    // Follow the link in both directions until no new jid shows up (two hops are enough in practice).
    for (let round = 0; round < 3; round++) {
      const before = jids.size
      for (const jid of [...jids]) {
        for (const r of altOf.all(jid) as { j: string }[]) jids.add(r.j)
        for (const r of chatsFor.all(jid) as { j: string }[]) jids.add(r.j)
      }
      if (jids.size === before) break
    }
    let removed = 0
    this.db.transaction(() => {
      for (const jid of jids)
        for (const table of ERASABLE_TABLES) removed += this.db.prepare(`DELETE FROM ${table} WHERE chat_id = ?`).run(jid).changes
    })()
    return { jids: [...jids], removed }
  }

  rememberSentId(id: string): void {
    this.db.prepare('INSERT OR IGNORE INTO sent_messages(id, created_at) VALUES (?, ?)').run(id, this.clock.now())
  }

  isSentId(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sent_messages WHERE id = ?').get(id)
  }

  countRepliesSince(chatId: string, sinceMs: number): number {
    const r = this.db
      .prepare("SELECT COUNT(*) c FROM turns WHERE chat_id = ? AND role = 'bot' AND created_at >= ?")
      .get(chatId, sinceMs) as { c: number }
    return r.c
  }

  private blank(chatId: string): ContactRow {
    return {
      chat_id: chatId, status: 'bot', stage: 'sapa', paused_until: null, lead_json: '{}',
      product_id: null, low_conf: 0, no_progress: 0, rule_counts: '{}'
    }
  }

  private toState(r: ContactRow): ContactState {
    return {
      chatId: r.chat_id,
      status: r.status,
      stage: r.stage,
      pausedUntil: r.paused_until,
      lead: JSON.parse(r.lead_json),
      productId: r.product_id,
      lowConfidenceStreak: r.low_conf,
      turnsWithoutProgress: r.no_progress,
      ruleCounts: JSON.parse(r.rule_counts)
    }
  }

  private write(s: ContactState): void {
    this.db
      .prepare(
        `INSERT INTO contacts(chat_id, status, stage, paused_until, lead_json, product_id, low_conf, no_progress, rule_counts, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET status = excluded.status, stage = excluded.stage,
           paused_until = excluded.paused_until, lead_json = excluded.lead_json, product_id = excluded.product_id,
           low_conf = excluded.low_conf, no_progress = excluded.no_progress, rule_counts = excluded.rule_counts,
           updated_at = excluded.updated_at`
      )
      .run(
        s.chatId, s.status, s.stage, s.pausedUntil, JSON.stringify(s.lead), s.productId,
        s.lowConfidenceStreak, s.turnsWithoutProgress, JSON.stringify(s.ruleCounts), this.clock.now()
      )
  }
}
