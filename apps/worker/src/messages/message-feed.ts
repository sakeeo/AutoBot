import { EventEmitter } from 'node:events'
import type { Db } from '../db'
import type { ChatSummary, FeedMessage } from '@autobot/contracts/ipc'
import type { IncomingMessage } from '@autobot/contracts/types'

export type { ChatSummary, FeedMessage }

type Handling = ChatSummary['handling']

const MAX_TEXT = 2000
const NON_TEXT = '(pesan non-teks)'

interface Row {
  id: number
  chat_id: string
  direction: FeedMessage['direction']
  text: string
  is_group: number
  created_at: number
}

const toMessage = (r: Row): FeedMessage => ({
  id: r.id, chatId: r.chat_id, direction: r.direction, text: r.text, at: r.created_at, isGroup: r.is_group === 1
})

const skipsFeed = (chatId: string): boolean => chatId.endsWith('@broadcast')

/** Records every message the bot sees or sends and announces each one, so the UI and notifications share one source. */
export class MessageFeed extends EventEmitter {
  constructor(private db: Db, private clock: { now(): number }) {
    super()
  }

  private insert(
    waId: string | null, chatId: string, direction: FeedMessage['direction'], text: string, isGroup: boolean, at: number,
    altJid: string | null = null
  ): FeedMessage | null {
    const clipped = text.slice(0, MAX_TEXT)
    const r = this.db
      .prepare('INSERT OR IGNORE INTO messages(wa_id, chat_id, direction, text, is_group, created_at, alt_jid) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(waId, chatId, direction, clipped, isGroup ? 1 : 0, at, altJid)
    if (r.changes === 0) return null
    const m: FeedMessage = { id: Number(r.lastInsertRowid), chatId, direction, text: clipped, at, isGroup }
    this.emit('message', m)
    return m
  }

  recordIncoming(m: IncomingMessage): FeedMessage | null {
    if (m.fromMe || skipsFeed(m.chatId)) return null
    return this.insert(`in:${m.id}`, m.chatId, 'in', m.text ?? NON_TEXT, m.isGroup, m.timestamp, m.altJid ?? null)
  }

  recordOutgoing(chatId: string, text: string, waId: string | null): FeedMessage {
    return this.insert(waId ? `out:${waId}` : null, chatId, 'out', text, chatId.endsWith('@g.us'), this.clock.now())!
  }

  /** A message typed by a person in the app itself. */
  recordAdmin(chatId: string, text: string, waId: string | null): FeedMessage {
    return this.insert(waId ? `human:${waId}` : null, chatId, 'human', text, false, this.clock.now())!
  }

  recordHuman(m: IncomingMessage): FeedMessage | null {
    if (skipsFeed(m.chatId)) return null
    return this.insert(`human:${m.id}`, m.chatId, 'human', m.text ?? NON_TEXT, m.isGroup, m.timestamp, m.altJid ?? null)
  }

  chats(limit = 100): ChatSummary[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.chat_id, m.direction, m.text, m.is_group, m.created_at, c.n, k.status AS k_status, k.paused_until AS k_until
         FROM messages m
         JOIN (SELECT MAX(id) AS mid, COUNT(*) AS n FROM messages GROUP BY chat_id) c ON m.id = c.mid
         LEFT JOIN contacts k ON k.chat_id = m.chat_id
         ORDER BY m.id DESC LIMIT ?`
      )
      .all(limit) as (Row & { n: number; k_status: Handling | null; k_until: number | null })[]
    const now = this.clock.now()
    return rows.map((r) => ({
      chatId: r.chat_id, isGroup: r.is_group === 1, last: toMessage(r), count: r.n,
      handling: r.k_status && r.k_status !== 'bot' && (r.k_until === null || r.k_until > now) ? r.k_status : 'bot'
    }))
  }

  thread(chatId: string, limit = 200): FeedMessage[] {
    const rows = this.db
      .prepare('SELECT id, chat_id, direction, text, is_group, created_at FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
      .all(chatId, limit) as Row[]
    return rows.reverse().map(toMessage)
  }
}
