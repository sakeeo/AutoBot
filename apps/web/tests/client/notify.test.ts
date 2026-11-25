import { describe, it, expect } from 'vitest'
import { FRESH_MS, attentionNotification, incomingNotification } from '../../src/client/notify'
import type { FeedMessage } from '@autobot/contracts/ipc'

const NOW = 1_700_000_000_000
const msg = (o: Partial<FeedMessage> = {}): FeedMessage => ({
  id: 1, chatId: '6281234567890@s.whatsapp.net', direction: 'in', text: 'berapa harga website?', at: NOW - 1000, isGroup: false, ...o
})
const ctx = (o: Partial<{ enabled: boolean; now: number }> = {}) => ({ enabled: true, now: NOW, ...o })

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
})

describe('attentionNotification', () => {
  it('says a message needs a manual reply, with its text', () => {
    expect(attentionNotification('escalate', { chatId: '6281@s.whatsapp.net', text: 'tolong bantu' })).toEqual({ title: 'Perlu dibalas manual', body: 'tolong bantu' })
  })
  it('falls back to the number when there is no text', () => {
    expect(attentionNotification('escalate', { chatId: '6281@s.whatsapp.net', text: null }).body).toBe('Pesan dari 6281')
  })
  it('says a customer was handed to the admin, with the reason', () => {
    expect(attentionNotification('handoff', { chatId: '6281@s.whatsapp.net', reason: 'komplain' })).toEqual({ title: 'Pelanggan diserahkan ke admin', body: '6281 · komplain' })
  })
})
