import { describe, it, expect } from 'vitest'
import { openDb, type Db } from '../../src/main/db'
import { BroadcastStore } from '../../src/main/broadcast/store'
import { syncChatContacts } from '../../src/main/broadcast/audience'

const NOW = 1_700_000_000_000
const DAY = 86_400_000
function setup() {
  const db = openDb(':memory:')
  const store = new BroadcastStore(db, { now: () => NOW })
  return { db, store }
}
let n = 0
const inLog = (db: Db, chat: string, at: number) =>
  db.prepare("INSERT INTO message_log(message_id, chat_id, decision, created_at, text) VALUES (?, ?, 'replied:ai', ?, 'halo')").run(`l${++n}`, chat, at)
const inMsg = (db: Db, chat: string, at: number, dir = 'in', group = 0) =>
  db.prepare('INSERT INTO messages(wa_id, chat_id, direction, text, is_group, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(`w${++n}`, chat, dir, 'halo', group, at)

describe('syncChatContacts', () => {
  it('creates contacts from the old message log and the new message table, once per person', () => {
    const { db, store } = setup()
    inLog(db, '628111111111@s.whatsapp.net', NOW - 10 * DAY)
    inMsg(db, '628111111111@s.whatsapp.net', NOW - 2 * DAY)
    inMsg(db, '628222222222@s.whatsapp.net', NOW - 1 * DAY)
    expect(syncChatContacts(db, store, NOW)).toBe(2)
    const a = store.findContact({ number: '628111111111' })!
    expect(a).toMatchObject({ source: 'chat', status: 'aktif', jid: '628111111111@s.whatsapp.net', lastInboundAt: NOW - 2 * DAY })
    expect(syncChatContacts(db, store, NOW)).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM broadcast_contacts').get()).toEqual({ n: 2 })
  })
  it('leaves out groups, broadcast lists, our own messages and anyone silent for over 365 days', () => {
    const { db, store } = setup()
    inMsg(db, '99@g.us', NOW - DAY, 'in', 1)
    inMsg(db, 'status@broadcast', NOW - DAY)
    inMsg(db, '628333333333@s.whatsapp.net', NOW - DAY, 'out')
    inMsg(db, '628444444444@s.whatsapp.net', NOW - 400 * DAY)
    inLog(db, '628555555555@s.whatsapp.net', NOW - 366 * DAY)
    expect(syncChatContacts(db, store, NOW)).toBe(0)
  })
  it('keeps a lid-only chat with no number, and refreshes the last-inbound time of an existing contact', () => {
    const { db, store } = setup()
    inMsg(db, 'abc123@lid', NOW - DAY)
    expect(syncChatContacts(db, store, NOW)).toBe(1)
    expect(store.findContact({ jid: 'abc123@lid' })).toMatchObject({ number: null, status: 'aktif' })
    inMsg(db, 'abc123@lid', NOW - 1000)
    expect(syncChatContacts(db, store, NOW)).toBe(0)
    expect(store.findContact({ jid: 'abc123@lid' })!.lastInboundAt).toBe(NOW - 1000)
  })
  it('does not turn an opted-out or inactive imported contact into an active chat contact', () => {
    const { db, store } = setup()
    store.upsertContact({ number: '628666666666', jid: null, source: 'impor', status: 'tidak_aktif' })
    inMsg(db, '628666666666@s.whatsapp.net', NOW - DAY)
    syncChatContacts(db, store, NOW)
    expect(store.findContact({ number: '628666666666' })!.status).toBe('tidak_aktif')
  })
  it('retires a chat contact who has been silent for over a year', () => {
    const { db, store } = setup()
    store.upsertContact({ number: '628777777777', jid: '628777777777@s.whatsapp.net', source: 'chat', status: 'aktif' })
    db.prepare('UPDATE broadcast_contacts SET last_inbound_at = ?').run(NOW - 400 * DAY)
    syncChatContacts(db, store, NOW)
    expect(store.findContact({ number: '628777777777' })!.status).toBe('tidak_aktif')
  })
})

