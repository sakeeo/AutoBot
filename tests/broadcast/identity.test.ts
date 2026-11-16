import { describe, it, expect } from 'vitest'
import { hashNumber, isLidJid, normalizePhone, numberFromJid } from '../../src/main/broadcast/identity'

describe('normalizePhone', () => {
  it('turns every common format into the same 62… number', () => {
    for (const raw of ['0812-3456-7890', '+62 812 3456 7890', '6281234567890', ' 081234567890 ', '(0812) 3456 7890'])
      expect(normalizePhone(raw), raw).toBe('6281234567890')
  })
  it('rejects values that are not phone numbers', () => {
    for (const raw of ['', '123', 'abc', '0'.repeat(16), '1234567890123456', '+', '---'])
      expect(normalizePhone(raw), raw).toBeNull()
  })
})

describe('jid helpers', () => {
  it('reads the number from a phone jid but not from a lid', () => {
    expect(numberFromJid('628111111111@s.whatsapp.net')).toBe('628111111111')
    expect(numberFromJid('abc123@lid')).toBeNull()
    expect(numberFromJid('99@g.us')).toBeNull()
    expect(isLidJid('abc123@lid')).toBe(true)
    expect(isLidJid('628111111111@s.whatsapp.net')).toBe(false)
  })
})

describe('hashNumber', () => {
  it('is deterministic per salt and differs between salts', () => {
    expect(hashNumber('628111111111', 's1')).toBe(hashNumber('628111111111', 's1'))
    expect(hashNumber('628111111111', 's1')).not.toBe(hashNumber('628111111111', 's2'))
    expect(hashNumber('628111111111', 's1')).toMatch(/^[0-9a-f]{64}$/)
  })
})
