import { describe, it, expect } from 'vitest'
import { base32Decode, base32Encode, hotp, newTotpSecret, otpauthUri, stepAt, verifyTotp } from '../src/server/auth/totp'

// RFC 4226 appendix D and RFC 6238 appendix B test vectors (the secret is the ASCII string "12345678901234567890").
const SECRET = Buffer.from('12345678901234567890')
const B32 = base32Encode(SECRET)

describe('base32', () => {
  it('round-trips and matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar')
    const s = newTotpSecret()
    expect(s).toMatch(/^[A-Z2-7]{32}$/) // 160 bits
    expect(base32Encode(base32Decode(s))).toBe(s)
  })
  it('ignores spaces and dashes users add, and rejects other characters', () => {
    expect(base32Decode('MZXW 6YTB-OI').toString()).toBe('foobar')
    expect(() => base32Decode('MZXW1')).toThrow()
  })
})

describe('hotp (RFC 4226)', () => {
  it.each([[0, '755224'], [1, '287082'], [2, '359152'], [3, '969429'], [4, '338314'], [5, '254676'], [6, '287922'], [7, '162583'], [8, '399871'], [9, '520489']])(
    'counter %i → %s', (counter, want) => expect(hotp(SECRET, counter)).toBe(want))
})

describe('totp (RFC 6238, SHA-1, 8 digits → last 6)', () => {
  it.each([[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']])(
    'at t=%i the code is %s', (t, want) => {
      expect(hotp(SECRET, stepAt(t * 1000))).toBe(want)
      expect(verifyTotp(B32, want, t * 1000)).toBe(stepAt(t * 1000))
    })
})

describe('verifyTotp', () => {
  const t = 1_700_000_000_000
  const codeAt = (ms: number) => hotp(SECRET, stepAt(ms))
  it('accepts the current step and one step either side, but not two', () => {
    expect(verifyTotp(B32, codeAt(t), t)).not.toBeNull()
    expect(verifyTotp(B32, codeAt(t - 30_000), t)).not.toBeNull()
    expect(verifyTotp(B32, codeAt(t + 30_000), t)).not.toBeNull()
    expect(verifyTotp(B32, codeAt(t - 60_000), t)).toBeNull()
    expect(verifyTotp(B32, codeAt(t + 60_000), t)).toBeNull()
  })
  it('refuses a step that was already used, or an older one', () => {
    const step = verifyTotp(B32, codeAt(t), t)!
    expect(verifyTotp(B32, codeAt(t), t, step)).toBeNull() // same step again
    expect(verifyTotp(B32, codeAt(t - 30_000), t, step)).toBeNull() // an older step after a newer one
    expect(verifyTotp(B32, codeAt(t + 30_000), t, step)).toBe(step + 1) // the next step is fine
  })
  it('rejects anything that is not exactly six digits, and a broken secret', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', ' 123456']) expect(verifyTotp(B32, bad, t), bad).toBeNull()
    expect(verifyTotp('not base32!', '123456', t)).toBeNull()
  })
})

describe('otpauthUri', () => {
  it('builds a URI authenticator apps accept, with the account and issuer encoded', () => {
    const u = otpauthUri('JBSWY3DPEHPK3PXP', 'budi@toko')
    expect(u).toBe('otpauth://totp/AutoBot:budi%40toko?secret=JBSWY3DPEHPK3PXP&issuer=AutoBot&algorithm=SHA1&digits=6&period=30')
  })
})
