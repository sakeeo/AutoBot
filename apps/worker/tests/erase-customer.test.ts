import { describe, it, expect } from 'vitest'
import { openDb } from '../src/db'
import { ConversationStore } from '../src/conversation/store'

const PHONE = '6281234@s.whatsapp.net'
const LID = '99887766@lid'
const OTHER = '6285555@s.whatsapp.net'
const TABLES = ['messages', 'message_log', 'turns', 'handoffs', 'contacts', 'events', 'cooldowns', 'contact_memory'] as const

function setup() {
  const clock = { t: 1_700_000_000_000, now() { return this.t } }
  const db = openDb(':memory:')
  const conv = new ConversationStore(db, clock)
  const seed = (chatId: string, altJid: string | null = null): void => {
    db.prepare('INSERT INTO messages(wa_id, chat_id, direction, text, is_group, created_at, alt_jid) VALUES (?, ?, ?, ?, 0, 1, ?)')
      .run(`in:${chatId}`, chatId, 'in', 'halo ini rahasia', altJid)
    db.prepare("INSERT INTO message_log(message_id, chat_id, decision, created_at, text) VALUES (?, ?, 'x', 1, 'halo')").run(`m:${chatId}`, chatId)
    conv.appendTurn(chatId, 'user', 'halo')
    conv.pauseFor(chatId, 'manusia', 1)
    conv.recordHandoff(chatId, 'komplain')
    conv.recordEvent(chatId, 'link_sent')
    db.prepare('INSERT INTO cooldowns(chat_id, last_at) VALUES (?, 1)').run(chatId)
    conv.setSummary(chatId, 'ringkasan pelanggan')
  }
  const count = (chatId: string): Record<string, number> =>
    Object.fromEntries(TABLES.map((t) => [t, (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE chat_id = ?`).get(chatId) as { c: number }).c]))
  return { db, conv, seed, count }
}

describe('eraseCustomer', () => {
  it('seeding really fills all eight tables (guards the test itself)', () => {
    const { seed, count } = setup()
    seed(PHONE)
    for (const t of TABLES) expect(count(PHONE)[t], t).toBeGreaterThan(0)
  })

  it('removes the customer from every table', () => {
    const { conv, seed, count } = setup()
    seed(PHONE)
    const r = conv.eraseCustomer(PHONE)
    expect(r.removed).toBeGreaterThanOrEqual(TABLES.length)
    for (const t of TABLES) expect(count(PHONE)[t], t).toBe(0)
  })

  it('leaves other customers untouched', () => {
    const { conv, seed, count } = setup()
    seed(PHONE)
    seed(OTHER)
    conv.eraseCustomer(PHONE)
    for (const t of TABLES) expect(count(OTHER)[t], t).toBeGreaterThan(0)
  })

  it('erases both the lid chat and the phone chat it is linked to, starting from either one', () => {
    for (const start of [LID, PHONE]) {
      const { conv, seed, count } = setup()
      seed(LID, PHONE) // the lid chat records the phone jid in alt_jid
      seed(PHONE)
      const r = conv.eraseCustomer(start)
      expect(r.jids.sort()).toEqual([LID, PHONE].sort())
      for (const jid of [LID, PHONE]) for (const t of TABLES) expect(count(jid)[t], `${start}:${jid}:${t}`).toBe(0)
    }
  })

  it('does not leave the conversation text anywhere in the database', () => {
    const { db, conv, seed } = setup()
    seed(PHONE)
    conv.eraseCustomer(PHONE)
    for (const t of TABLES) {
      const rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]
      expect(JSON.stringify(rows), t).not.toContain('rahasia')
      expect(JSON.stringify(rows), t).not.toContain('ringkasan pelanggan')
    }
  })

  it('is a no-op for an unknown chat', () => {
    const { conv } = setup()
    expect(conv.eraseCustomer('0@s.whatsapp.net')).toEqual({ jids: ['0@s.whatsapp.net'], removed: 0 })
  })
})
