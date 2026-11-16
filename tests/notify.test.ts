import { describe, it, expect } from 'vitest'
import { FRESH_MS, incomingNotification } from '../src/main/notify'
import type { FeedMessage } from '../src/shared/ipc'

const NOW = 1_700_000_000_000
const msg = (o: Partial<FeedMessage> = {}): FeedMessage => ({
  id: 1, chatId: '6281234567890@s.whatsapp.net', direction: 'in', text: 'berapa harga website?', at: NOW - 1000, isGroup: false, ...o
})
const ctx = (o: Partial<{ enabled: boolean; locked: boolean; now: number }> = {}) => ({ enabled: true, locked: false, now: NOW, ...o })

describe('incomingNotification', () => {
  it('names the sender by number and shows the message', () => {
    expect(incomingNotification(msg(), ctx())).toEqual({ title: 'Pesan dari 6281234567890', body: 'berapa harga website?' })
  })
  it('uses a group title for group chats', () => {
    expect(incomingNotification(msg({ isGroup: true, chatId: '99@g.us' }), ctx())?.title).toBe('Pesan di grup')
  })
  it('stays quiet when switched off', () => {
    expect(incomingNotification(msg(), ctx({ enabled: false }))).toBeNull()
  })
  it('only notifies for incoming messages, not bot replies or human messages', () => {
    expect(incomingNotification(msg({ direction: 'out' }), ctx())).toBeNull()
    expect(incomingNotification(msg({ direction: 'human' }), ctx())).toBeNull()
  })
  it('does not notify for old history: 119 s is fresh, 121 s is not', () => {
    expect(FRESH_MS).toBe(120_000)
    expect(incomingNotification(msg({ at: NOW - 119_000 }), ctx())).not.toBeNull()
    expect(incomingNotification(msg({ at: NOW - 121_000 }), ctx())).toBeNull()
  })
  it('cuts long messages to 120 characters', () => {
    const n = incomingNotification(msg({ text: 'a'.repeat(300) }), ctx())!
    expect(n.body).toHaveLength(120)
  })
  it('shows a placeholder for an empty body', () => {
    expect(incomingNotification(msg({ text: '' }), ctx())!.body).toBe('(pesan non-teks)')
  })
  it('hides both the sender and the text while the app is locked', () => {
    const n = incomingNotification(msg(), ctx({ locked: true }))!
    expect(n).toEqual({ title: 'WA Otomation', body: 'Ada pesan baru' })
    expect(JSON.stringify(n)).not.toMatch(/6281|harga/)
  })
  it('still respects the switch and freshness while locked', () => {
    expect(incomingNotification(msg(), ctx({ locked: true, enabled: false }))).toBeNull()
    expect(incomingNotification(msg({ at: NOW - 999_999 }), ctx({ locked: true }))).toBeNull()
  })
})
