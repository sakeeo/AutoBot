import { randomBytes, randomInt } from 'node:crypto'
import type { AuthDb } from './db'
import { safeEqual, type Keys } from './crypto'
import type { Clock } from './throttle'

/** What a code is for. A code for one purpose never works for another. */
export type OtpPurpose = 'setup' | 'reset' | 'change_phone'

const MIN = 60_000
export const OTP = {
  ttlMs: 5 * MIN,
  maxAttempts: 5,
  cooldownMs: 60_000,
  perPhone: { max: 3, windowMs: 15 * MIN },
  perPurposeDay: 10,
  globalHour: 10,
  suspendAfterFailures: 15,
  suspendMs: 60 * MIN
} as const

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'COOLDOWN' | 'RATE_LIMITED' | 'SUSPENDED'; retryAfterSec: number }
export type VerifyResult = { ok: true } | { ok: false; reason: 'INVALID' | 'SUSPENDED' }

/**
 * One-time codes sent to the owner's WhatsApp. Only an HMAC of the code is stored (a plain hash of six digits could be
 * guessed offline), the HMAC covers the purpose and the challenge id, and every limit is counted from the database so a
 * restart does not reset it.
 */
export class OtpService {
  constructor(private db: AuthDb, private keys: Keys, private clock: Clock) {}

  private hmac(purpose: OtpPurpose, id: string, code: string): string {
    return this.keys.hmac('otp', purpose, id, code)
  }

  suspendedForSec(): number {
    const now = this.clock.now()
    const recent = this.db.prepare('SELECT at FROM otp_failures WHERE at > ? ORDER BY at DESC').all(now - 24 * 60 * MIN) as { at: number }[]
    if (recent.length < OTP.suspendAfterFailures) return 0
    const until = recent[0].at + OTP.suspendMs
    return until > now ? Math.ceil((until - now) / 1000) : 0
  }

  /** Makes a new code if every limit allows it. The caller delivers it; this never sends anything itself. */
  issue(purpose: OtpPurpose, phone: string): IssueResult {
    const now = this.clock.now()
    const suspended = this.suspendedForSec()
    if (suspended > 0) return { ok: false, reason: 'SUSPENDED', retryAfterSec: suspended }

    const last = this.db.prepare('SELECT MAX(created_at) AS t FROM otp_challenges WHERE phone = ?').get(phone) as { t: number | null }
    if (last.t !== null && now - last.t < OTP.cooldownMs) return { ok: false, reason: 'COOLDOWN', retryAfterSec: Math.ceil((OTP.cooldownMs - (now - last.t)) / 1000) }

    const count = (sql: string, ...args: unknown[]): number => (this.db.prepare(sql).get(...args) as { c: number }).c
    const phoneRecent = this.db.prepare('SELECT created_at FROM otp_challenges WHERE phone = ? AND created_at > ? ORDER BY created_at').all(phone, now - OTP.perPhone.windowMs) as { created_at: number }[]
    if (phoneRecent.length >= OTP.perPhone.max)
      return { ok: false, reason: 'RATE_LIMITED', retryAfterSec: Math.ceil((phoneRecent[0].created_at + OTP.perPhone.windowMs - now) / 1000) }
    if (count('SELECT COUNT(*) AS c FROM otp_challenges WHERE purpose = ? AND created_at > ?', purpose, now - 24 * 60 * MIN) >= OTP.perPurposeDay)
      return { ok: false, reason: 'RATE_LIMITED', retryAfterSec: 3600 }
    if (count('SELECT COUNT(*) AS c FROM otp_challenges WHERE created_at > ?', now - 60 * MIN) >= OTP.globalHour)
      return { ok: false, reason: 'RATE_LIMITED', retryAfterSec: 600 }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const id = randomBytes(16).toString('hex')
    this.db.transaction(() => {
      // a new code retires the old one for the same purpose and number
      this.db.prepare('UPDATE otp_challenges SET consumed_at = ? WHERE purpose = ? AND phone = ? AND consumed_at IS NULL').run(now, purpose, phone)
      this.db
        .prepare('INSERT INTO otp_challenges(id, purpose, phone, code_hmac, expires_at, max_attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, purpose, phone, this.hmac(purpose, id, code), now + OTP.ttlMs, OTP.maxAttempts, now)
    })()
    return { ok: true, code }
  }

  verify(purpose: OtpPurpose, phone: string, code: string): VerifyResult {
    if (this.suspendedForSec() > 0) return { ok: false, reason: 'SUSPENDED' }
    const now = this.clock.now()
    const row = this.db
      .prepare('SELECT id, code_hmac, expires_at, attempts, max_attempts FROM otp_challenges WHERE purpose = ? AND phone = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1')
      .get(purpose, phone) as { id: string; code_hmac: string; expires_at: number; attempts: number; max_attempts: number } | undefined
    // always do the same work, whether or not a live challenge exists
    const given = this.hmac(purpose, row?.id ?? 'none', /^\d{6}$/.test(code) ? code : '------')
    const live = !!row && row.expires_at > now && row.attempts < row.max_attempts
    const match = live && safeEqual(given, row.code_hmac)
    if (match) {
      this.db.prepare('UPDATE otp_challenges SET consumed_at = ? WHERE id = ?').run(now, row.id)
      return { ok: true }
    }
    this.db.transaction(() => {
      if (live) {
        const attempts = row.attempts + 1
        this.db.prepare('UPDATE otp_challenges SET attempts = ?, consumed_at = ? WHERE id = ?').run(attempts, attempts >= row.max_attempts ? now : null, row.id)
      }
      this.db.prepare('INSERT INTO otp_failures(at) VALUES (?)').run(now)
    })()
    return { ok: false, reason: 'INVALID' }
  }
}
