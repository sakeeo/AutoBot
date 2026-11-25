import { createHmac, randomBytes } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const STEP_SECONDS = 30
export const DIGITS = 6

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new Error('BASE32_INVALID')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A fresh 160-bit secret, as the base32 text that authenticator apps expect. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20))

/** RFC 4226 HOTP with HMAC-SHA1. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', secret).update(msg).digest()
  const off = h[h.length - 1] & 0x0f
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS)

/**
 * RFC 6238. Accepts the current step and one step either side (clock drift). Returns the step that matched, so the caller
 * can refuse the same step twice (a code seen by someone over your shoulder is worthless once you have used it), or null.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastStep = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null
  let secret: Buffer
  try { secret = base32Decode(secretBase32) } catch { return null }
  const now = stepAt(nowMs)
  let hit: number | null = null
  // every candidate is computed (no early exit), so timing does not tell which step was close
  for (const step of [now - 1, now, now + 1]) {
    if (hotp(secret, step) === code && step > lastStep && (hit === null || step > hit)) hit = step
  }
  return hit
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'AutoBot'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}
