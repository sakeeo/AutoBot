import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/** Separate keys for separate jobs, all derived from the one deployment secret (so leaking one use does not leak the others). */
export type KeyPurpose = 'otp' | 'recovery' | 'totp' | 'setup-token' | 'ip'

export class Keys {
  private cache = new Map<KeyPurpose, Buffer>()
  constructor(private master: Buffer) {
    if (master.length !== 32) throw new Error('AUTH_SECRET_KEY harus 32 byte.')
  }
  for(purpose: KeyPurpose): Buffer {
    let k = this.cache.get(purpose)
    if (!k) {
      k = Buffer.from(hkdfSync('sha256', this.master, Buffer.alloc(0), `autobot-web:${purpose}`, 32))
      this.cache.set(purpose, k)
    }
    return k
  }
  hmac(purpose: KeyPurpose, ...parts: string[]): string {
    return createHmac('sha256', this.for(purpose)).update(parts.join('\u0000')).digest('hex')
  }
  /** AES-256-GCM; the label is authenticated, so a value cannot be moved to another place. */
  seal(purpose: KeyPurpose, label: string, plain: string): string {
    const nonce = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.for(purpose), nonce)
    c.setAAD(Buffer.from(label))
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return Buffer.concat([nonce, c.getAuthTag(), enc]).toString('base64')
  }
  open(purpose: KeyPurpose, label: string, sealed: string): string | null {
    try {
      const raw = Buffer.from(sealed, 'base64')
      const d = createDecipheriv('aes-256-gcm', this.for(purpose), raw.subarray(0, 12))
      d.setAAD(Buffer.from(label))
      d.setAuthTag(raw.subarray(12, 28))
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
    } catch {
      return null
    }
  }
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest()
  const db = createHash('sha256').update(b).digest()
  return timingSafeEqual(da, db) && a.length === b.length
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')
