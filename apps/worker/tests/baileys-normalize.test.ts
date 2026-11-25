import { describe, it, expect } from 'vitest'
import {
  normalizeMessage, nextReconnect, shouldHandleUpsert, selfNumberFromJid, jidForNumber
} from '../src/wa/baileys-gateway'

const base = (message: any, key: any = {}) => ({
  key: { id: 'ABC', remoteJid: '6281@s.whatsapp.net', fromMe: false, ...key },
  message,
  messageTimestamp: 1_700_000_000
})

describe('normalizeMessage', () => {
  it('reads plain conversation text and converts seconds to ms', () => {
    const m = normalizeMessage(base({ conversation: 'halo' }))!
    expect(m).toMatchObject({ id: 'ABC', chatId: '6281@s.whatsapp.net', text: 'halo', isGroup: false, fromMe: false })
    expect(m.timestamp).toBe(1_700_000_000_000)
  })
  it('reads extendedTextMessage text', () => {
    expect(normalizeMessage(base({ extendedTextMessage: { text: 'harga?' } }))!.text).toBe('harga?')
  })
  it('reads image and video captions', () => {
    expect(normalizeMessage(base({ imageMessage: { caption: 'lihat ini' } }))!.text).toBe('lihat ini')
    expect(normalizeMessage(base({ videoMessage: { caption: 'video' } }))!.text).toBe('video')
  })
  it('gives text null for an image without caption, sticker and audio', () => {
    expect(normalizeMessage(base({ imageMessage: {} }))!.text).toBeNull()
    expect(normalizeMessage(base({ stickerMessage: {} }))!.text).toBeNull()
    expect(normalizeMessage(base({ audioMessage: { ptt: true } }))!.text).toBeNull()
  })
  it('unwraps ephemeral messages', () => {
    expect(normalizeMessage(base({ ephemeralMessage: { message: { conversation: 'rahasia' } } }))!.text).toBe('rahasia')
  })
  it('marks group chats and uses the participant as sender', () => {
    const m = normalizeMessage(base({ conversation: 'hi' }, { remoteJid: '123@g.us', participant: '6282@s.whatsapp.net' }))!
    expect(m.isGroup).toBe(true)
    expect(m.sender).toBe('6282@s.whatsapp.net')
  })
  it('returns null when the key has no id or there is no message', () => {
    expect(normalizeMessage(base({ conversation: 'x' }, { id: undefined }))).toBeNull()
    expect(normalizeMessage({ key: { id: 'A', remoteJid: 'x' } } as any)).toBeNull()
  })
  it('accepts a Long-like timestamp', () => {
    const raw = { ...base({ conversation: 'x' }), messageTimestamp: { toNumber: () => 1_700_000_001 } }
    expect(normalizeMessage(raw as any)!.timestamp).toBe(1_700_000_001_000)
  })
})

describe('nextReconnect', () => {
  it('does not reconnect after loggedOut (401) and asks to clear the session', () => {
    expect(nextReconnect(401, 0)).toEqual({ reconnect: false, delayMs: 0, clearSession: true })
  })
  it('does not reconnect when the connection was replaced (440) and keeps the session', () => {
    expect(nextReconnect(440, 0)).toEqual({ reconnect: false, delayMs: 0, clearSession: false })
  })
  it('backs off exponentially from 1s to a 60s cap', () => {
    expect(nextReconnect(515, 0).delayMs).toBe(1000)
    expect(nextReconnect(515, 3).delayMs).toBe(8000)
    expect(nextReconnect(515, 20).delayMs).toBe(60000)
    expect(nextReconnect(undefined, 1)).toMatchObject({ reconnect: true, clearSession: false })
  })
})

describe('shouldHandleUpsert', () => {
  it('handles live notifications, not history sync or appended customer messages', () => {
    expect(shouldHandleUpsert('notify')).toBe(true)
    expect(shouldHandleUpsert('append')).toBe(false)
    expect(shouldHandleUpsert('history')).toBe(false)
  })
  it('also forwards appended messages that we sent (a human typing from the phone)', () => {
    expect(shouldHandleUpsert('append', true)).toBe(true)
    expect(shouldHandleUpsert('append', false)).toBe(false)
    expect(shouldHandleUpsert('history', true)).toBe(false)
  })
})

describe('own messages', () => {
  it('still normalises messages sent by us', () => {
    const m = normalizeMessage(base({ conversation: 'dari HP admin' }, { fromMe: true }))!
    expect(m.fromMe).toBe(true)
    expect(m.text).toBe('dari HP admin')
  })
})

describe('account helpers', () => {
  it('extracts the digits of the linked number from a device jid', () => {
    expect(selfNumberFromJid('6285119308345:12@s.whatsapp.net')).toBe('6285119308345')
    expect(selfNumberFromJid('6285119308345@s.whatsapp.net')).toBe('6285119308345')
    expect(selfNumberFromJid(undefined)).toBeNull()
  })
  it('builds a user jid from any phone number format', () => {
    expect(jidForNumber('0812-3456-7890')).toBe('6281234567890@s.whatsapp.net')
    expect(jidForNumber('+62 812 3456 7890')).toBe('6281234567890@s.whatsapp.net')
  })
})

describe('normalizeMessage alternate (phone) jid', () => {
  const base = { key: { id: 'A1', remoteJid: 'abc123@lid' }, message: { conversation: 'stop' }, messageTimestamp: 1_700_000_000 }
  it('keeps the phone jid WhatsApp reports next to a lid chat', () => {
    expect(normalizeMessage({ ...base, key: { ...base.key, remoteJidAlt: '628111111111@s.whatsapp.net' } })?.altJid).toBe('628111111111@s.whatsapp.net')
    expect(normalizeMessage({ ...base, key: { ...base.key, senderPn: '628222222222@s.whatsapp.net' } })?.altJid).toBe('628222222222@s.whatsapp.net')
  })
  it('has no alternate jid when WhatsApp gives none', () => {
    expect(normalizeMessage(base)?.altJid).toBeUndefined()
  })
})
