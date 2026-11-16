import { describe, it, expect } from 'vitest'
import { normalizeMessage, nextReconnect, shouldHandleUpsert } from '../src/main/wa/baileys-gateway'

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
  it('only handles live notifications, not history sync or appended messages', () => {
    expect(shouldHandleUpsert('notify')).toBe(true)
    expect(shouldHandleUpsert('append')).toBe(false)
    expect(shouldHandleUpsert('history')).toBe(false)
  })
})
