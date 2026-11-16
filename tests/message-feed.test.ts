import { describe, it, expect, vi } from 'vitest'
import { openDb } from '../src/main/db'
import { MessageFeed } from '../src/main/messages/message-feed'
import type { IncomingMessage } from '../src/shared/types'

function setup() {
  const db = openDb(':memory:')
  const clock = { t: 1_700_000_000_000, now() { return this.t } }
  return { db, clock, feed: new MessageFeed(db, clock) }
}
let n = 0
const msg = (o: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: `w${++n}`, chatId: '6281@s.whatsapp.net', sender: '6281@s.whatsapp.net',
  isGroup: false, fromMe: false, text: 'halo', timestamp: 1_700_000_000_000, ...o
})

describe('MessageFeed.recordIncoming', () => {
  it('stores the message with its own timestamp and announces it', () => {
    const { feed } = setup()
    const seen = vi.fn()
    feed.on('message', seen)
    const m = feed.recordIncoming(msg({ text: 'berapa harga?', timestamp: 1_699_999_999_000 }))
    expect(m).toMatchObject({ chatId: '6281@s.whatsapp.net', direction: 'in', text: 'berapa harga?', at: 1_699_999_999_000, isGroup: false })
    expect(typeof m!.id).toBe('number')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0]).toEqual(m)
  })
  it('records the same WhatsApp id only once and announces it once', () => {
    const { feed } = setup()
    const seen = vi.fn()
    feed.on('message', seen)
    const first = msg()
    expect(feed.recordIncoming(first)).not.toBeNull()
    expect(feed.recordIncoming(first)).toBeNull()
    expect(feed.thread(first.chatId)).toHaveLength(1)
    expect(seen).toHaveBeenCalledTimes(1)
  })
  it('skips own messages, status updates and broadcast lists', () => {
    const { feed } = setup()
    expect(feed.recordIncoming(msg({ fromMe: true }))).toBeNull()
    expect(feed.recordIncoming(msg({ chatId: 'status@broadcast' }))).toBeNull()
    expect(feed.recordIncoming(msg({ chatId: '123@broadcast' }))).toBeNull()
    expect(feed.chats()).toEqual([])
  })
  it('labels non-text messages and caps very long text at 2000 characters', () => {
    const { feed } = setup()
    expect(feed.recordIncoming(msg({ text: null }))!.text).toBe('(pesan non-teks)')
    expect(feed.recordIncoming(msg({ text: 'x'.repeat(5000) }))!.text).toHaveLength(2000)
  })
  it('marks group chats', () => {
    const { feed } = setup()
    const m = feed.recordIncoming(msg({ chatId: '99@g.us', isGroup: true }))!
    expect(m.isGroup).toBe(true)
  })
})

describe('MessageFeed.recordOutgoing and recordHuman', () => {
  it('stores bot replies as "out" at the current time', () => {
    const { feed, clock } = setup()
    clock.t += 5_000
    const m = feed.recordOutgoing('6281@s.whatsapp.net', 'Harga Rp25.000', 'ABC')
    expect(m).toMatchObject({ direction: 'out', text: 'Harga Rp25.000', at: clock.t, isGroup: false })
  })
  it('an outgoing message may share its WhatsApp id with an incoming one without clashing', () => {
    const { feed } = setup()
    expect(feed.recordIncoming(msg({ id: 'SAME' }))).not.toBeNull()
    expect(() => feed.recordOutgoing('6281@s.whatsapp.net', 'balasan', 'SAME')).not.toThrow()
    expect(feed.thread('6281@s.whatsapp.net')).toHaveLength(2)
  })
  it('several outgoing messages without an id are all kept', () => {
    const { feed } = setup()
    feed.recordOutgoing('6281@s.whatsapp.net', 'a', null)
    feed.recordOutgoing('6281@s.whatsapp.net', 'b', null)
    expect(feed.thread('6281@s.whatsapp.net').map((m) => m.text)).toEqual(['a', 'b'])
  })
  it('stores a message typed by a human as "human" and ignores a repeat', () => {
    const { feed } = setup()
    const m = msg({ fromMe: true, text: 'saya admin' })
    expect(feed.recordHuman(m)).toMatchObject({ direction: 'human', text: 'saya admin' })
    expect(feed.recordHuman(m)).toBeNull()
  })
})

describe('MessageFeed.chats and thread', () => {
  it('lists chats newest first with the last message and a count, honouring the limit', () => {
    const { feed } = setup()
    feed.recordIncoming(msg({ chatId: 'a@s.whatsapp.net', text: 'a1' }))
    feed.recordIncoming(msg({ chatId: 'b@s.whatsapp.net', text: 'b1' }))
    feed.recordOutgoing('a@s.whatsapp.net', 'a-balasan', 'x1')
    const chats = feed.chats()
    expect(chats.map((c) => c.chatId)).toEqual(['a@s.whatsapp.net', 'b@s.whatsapp.net'])
    expect(chats[0]).toMatchObject({ count: 2, isGroup: false })
    expect(chats[0].last).toMatchObject({ direction: 'out', text: 'a-balasan' })
    expect(feed.chats(1)).toHaveLength(1)
  })
  it('returns a thread oldest first and keeps only the newest messages when limited', () => {
    const { feed } = setup()
    for (let i = 1; i <= 5; i++) feed.recordIncoming(msg({ text: `p${i}` }))
    expect(feed.thread('6281@s.whatsapp.net').map((m) => m.text)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(feed.thread('6281@s.whatsapp.net', 2).map((m) => m.text)).toEqual(['p4', 'p5'])
  })
  it('keeps chats apart and returns an empty list for an unknown chat', () => {
    const { feed } = setup()
    feed.recordIncoming(msg({ chatId: 'a@s.whatsapp.net' }))
    expect(feed.thread('b@s.whatsapp.net')).toEqual([])
  })
})
