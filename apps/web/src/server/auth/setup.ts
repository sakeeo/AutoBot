import { normalizeNumber } from '@autobot/contracts/brand'
import type { AuthDb } from './db'
import { safeEqual, randomToken, type Keys } from './crypto'
import { hashPassword, passwordProblem } from './password'
import { RateWindow, type Clock } from './throttle'
import type { OtpService } from './otp'
import type { RecoveryCodes } from './recovery'
import type { Sessions } from './sessions'
import type { Audit } from './audit'
import { newTotpSecret, otpauthUri, verifyTotp } from './totp'
import { fail, maskPhone, type Ctx, type Out, type WorkerPort } from './types'

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/

export interface SetupDeps {
  db: AuthDb; keys: Keys; clock: Clock; sessions: Sessions; rate: RateWindow; otp: OtpService
  recovery: RecoveryCodes; audit: Audit; worker: WorkerPort
}

interface StateRow {
  token_hmac: string; owner_phone: string | null; owner_phone_verified_at: number | null; username: string | null
  password_hash: string | null; totp_secret_enc: string | null; totp_verified_at: number | null
  totp_last_step: number; recovery_hmacs: string | null
}

export function validPhone(raw: string): string | null {
  const n = normalizeNumber(raw)
  return /^[1-9]\d{7,14}$/.test(n) ? n : null
}

/**
 * The first-run wizard. Until the account exists the panel is closed to everyone who does not hold the setup token
 * (printed in the server log), and finishing is one atomic step, so two browsers cannot both create an account.
 */
export class SetupService {
  constructor(private d: SetupDeps) {}

  isComplete(): boolean {
    return !!this.d.db.prepare('SELECT 1 FROM users').get()
  }

  /** At every start before the account exists: makes a fresh token (the old one dies). Returns it to be printed. */
  ensureToken(): string | null {
    if (this.isComplete()) {
      this.d.db.prepare('DELETE FROM setup_state').run()
      return null
    }
    const token = randomToken(32)
    this.d.db
      .prepare('INSERT INTO setup_state(id, token_hmac, created_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hmac = excluded.token_hmac')
      .run(this.d.keys.hmac('setup-token', token), this.d.clock.now())
    this.d.sessions.revokeKind('setup')
    return token
  }

  submitToken(token: string, ctx: Ctx): Out<{ sessionToken: string }> {
    if (this.isComplete()) return fail('NOT_FOUND', 'Tidak ditemukan.')
    if (!this.d.rate.consume(`setup-token:ip:${ctx.ipHash}`, 5, 60_000) || !this.d.rate.consume('setup-token:all', 30, 3_600_000))
      return fail('THROTTLED', 'Terlalu banyak percobaan. Tunggu sebentar.', 60)
    const row = this.d.db.prepare('SELECT token_hmac FROM setup_state WHERE id = 1').get() as { token_hmac: string } | undefined
    const given = this.d.keys.hmac('setup-token', String(token).slice(0, 200))
    if (!row || !safeEqual(given, row.token_hmac)) {
      this.d.audit.log('setup_token_rejected', { ipHash: ctx.ipHash })
      return fail('BAD_CREDENTIALS', 'Token setup salah.')
    }
    // the newest entry wins: an older wizard session stops working
    this.d.sessions.revokeKind('setup')
    const s = this.d.sessions.create('setup', { ipHash: ctx.ipHash, userAgent: ctx.userAgent })
    this.d.audit.log('setup_started', { ipHash: ctx.ipHash })
    return { ok: true, sessionToken: s.token }
  }

  private state(): StateRow | undefined {
    return this.d.db.prepare('SELECT * FROM setup_state WHERE id = 1').get() as StateRow | undefined
  }

  progress(): { ownerPhone: string | null; phoneVerified: boolean; hasAccount: boolean; totpVerified: boolean } {
    const s = this.state()
    return {
      ownerPhone: s?.owner_phone ? maskPhone(s.owner_phone) : null,
      phoneVerified: !!s?.owner_phone_verified_at,
      hasAccount: !!s?.password_hash,
      totpVerified: !!s?.totp_verified_at
    }
  }

  /** The number that will receive verification codes. It must be a different number from the bot's own. */
  async setOwnerPhone(raw: string): Promise<Out> {
    const phone = validPhone(raw)
    if (!phone) return fail('VALIDATION', 'Nomor tidak valid. Tulis dengan kode negara, misalnya 62812xxxxxxx.')
    const bot = await this.d.worker.selfNumber().catch(() => null)
    if (bot && bot === phone) return fail('VALIDATION', 'Nomor pemilik harus berbeda dari nomor WhatsApp yang dipakai bot.')
    this.d.db
      .prepare('UPDATE setup_state SET owner_phone = ?, owner_phone_verified_at = NULL WHERE id = 1')
      .run(phone)
    return { ok: true }
  }

  async sendOwnerOtp(ctx: Ctx): Promise<Out<{ sentTo: string }>> {
    const s = this.state()
    if (!s?.owner_phone) return fail('VALIDATION', 'Isi nomor pemilik lebih dulu.')
    const bot = await this.d.worker.selfNumber().catch(() => null)
    if (!bot) return fail('WA_UNAVAILABLE', 'WhatsApp belum terhubung. Hubungkan WhatsApp dulu, baru kirim kode.')
    if (bot === s.owner_phone) return fail('VALIDATION', 'Nomor pemilik harus berbeda dari nomor WhatsApp yang dipakai bot.')
    const issued = this.d.otp.issue('setup', s.owner_phone)
    if (!issued.ok) return fail('OTP_UNAVAILABLE', otpMessage(issued.reason), issued.retryAfterSec)
    const sent = await this.d.worker.systemSend({ to: s.owner_phone, kind: 'otp_setup', code: issued.code }).catch(() => ({ ok: false as const, code: 'WA_DISCONNECTED' }))
    if (!sent.ok) {
      this.d.audit.log('setup_otp_send_failed', { ipHash: ctx.ipHash, detail: { reason: sent.code } })
      return fail('WA_UNAVAILABLE', sendFailure(sent.code))
    }
    this.d.audit.log('setup_otp_sent', { ipHash: ctx.ipHash })
    return { ok: true, sentTo: maskPhone(s.owner_phone) }
  }

  verifyOwnerOtp(code: string, ctx: Ctx): Out {
    const s = this.state()
    if (!s?.owner_phone) return fail('VALIDATION', 'Isi nomor pemilik lebih dulu.')
    const r = this.d.otp.verify('setup', s.owner_phone, String(code))
    if (!r.ok) {
      this.d.audit.log('setup_otp_failed', { ipHash: ctx.ipHash })
      return r.reason === 'SUSPENDED'
        ? fail('OTP_UNAVAILABLE', 'Terlalu banyak kode salah. Coba lagi dalam satu jam.', 3600)
        : fail('INVALID_CODE', 'Kode salah atau sudah kedaluwarsa.')
    }
    this.d.db.prepare('UPDATE setup_state SET owner_phone_verified_at = ? WHERE id = 1').run(this.d.clock.now())
    this.d.audit.log('setup_phone_verified', { ipHash: ctx.ipHash })
    return { ok: true }
  }

  async setAccount(usernameRaw: string, password: string): Promise<Out<{ secret: string; uri: string }>> {
    const s = this.state()
    if (!s?.owner_phone_verified_at) return fail('FORBIDDEN', 'Verifikasi nomor pemilik dulu.')
    const username = String(usernameRaw).trim().toLowerCase()
    if (!USERNAME_PATTERN.test(username)) return fail('VALIDATION', 'Username 3–32 karakter: huruf kecil, angka, titik, garis bawah atau strip.')
    const problem = passwordProblem(String(password), username)
    if (problem) return fail('VALIDATION', problem)
    const secret = newTotpSecret()
    this.d.db
      .prepare('UPDATE setup_state SET username = ?, password_hash = ?, totp_secret_enc = ?, totp_verified_at = NULL, totp_last_step = 0, recovery_hmacs = NULL WHERE id = 1')
      .run(username, await hashPassword(String(password)), this.d.keys.seal('totp', 'setup', secret))
    return { ok: true, secret, uri: otpauthUri(secret, username) }
  }

  /** The first authenticator code proves the app is set up; then the recovery codes are made (shown this once). */
  verifyTotp(code: string, ctx: Ctx): Out<{ recoveryCodes: string[] }> {
    const s = this.state()
    if (!s?.totp_secret_enc || !s.username) return fail('FORBIDDEN', 'Buat username dan password dulu.')
    const secret = this.d.keys.open('totp', 'setup', s.totp_secret_enc)
    const step = secret ? verifyTotp(secret, String(code), this.d.clock.now(), 0) : null
    if (step === null) {
      this.d.audit.log('setup_totp_failed', { ipHash: ctx.ipHash })
      return fail('INVALID_CODE', 'Kode authenticator salah. Pastikan jam ponsel Anda tepat.')
    }
    const { shown, hmacs } = this.d.recovery.generate()
    this.d.db
      .prepare('UPDATE setup_state SET totp_verified_at = ?, totp_last_step = ?, recovery_hmacs = ? WHERE id = 1')
      .run(this.d.clock.now(), step, JSON.stringify(hmacs))
    return { ok: true, recoveryCodes: shown }
  }

  /** The one atomic step that creates the owner. A second browser finishing at the same moment gets CONFLICT. */
  finish(confirmedSaved: boolean, ctx: Ctx): Out<{ sessionToken: string }> {
    if (confirmedSaved !== true) return fail('VALIDATION', 'Centang dulu bahwa kode pemulihan sudah Anda simpan.')
    const s = this.state()
    if (!s?.owner_phone || !s.owner_phone_verified_at || !s.username || !s.password_hash || !s.totp_secret_enc || !s.totp_verified_at || !s.recovery_hmacs)
      return fail('FORBIDDEN', 'Langkah setup belum lengkap.')
    const now = this.d.clock.now()
    const secret = this.d.keys.open('totp', 'setup', s.totp_secret_enc)
    if (!secret) return fail('FORBIDDEN', 'Langkah setup belum lengkap.')
    try {
      this.d.db.transaction(() => {
        this.d.db
          .prepare('INSERT INTO users(id, username, password_hash, owner_phone, created_at, password_changed_at, totp_secret_enc, totp_last_step) VALUES (1, ?, ?, ?, ?, ?, ?, ?)')
          .run(s.username, s.password_hash, s.owner_phone, now, now, this.d.keys.seal('totp', 'user:1', secret), s.totp_last_step)
        this.d.recovery.replaceAll(JSON.parse(s.recovery_hmacs as string) as string[])
        this.d.db.prepare('DELETE FROM setup_state').run()
        this.d.sessions.revokeKind('setup')
      })()
    } catch {
      return fail('CONFLICT', 'Akun pemilik sudah dibuat.')
    }
    this.d.audit.log('setup_completed', { actor: s.username, ipHash: ctx.ipHash })
    // The owner just proved password and authenticator code, so the wizard ends signed in.
    const session = this.d.sessions.create('owner', { ipHash: ctx.ipHash, userAgent: ctx.userAgent })
    return { ok: true, sessionToken: session.token }
  }
}

export function otpMessage(reason: 'COOLDOWN' | 'RATE_LIMITED' | 'SUSPENDED'): string {
  switch (reason) {
    case 'COOLDOWN': return 'Tunggu sebentar sebelum meminta kode lagi.'
    case 'RATE_LIMITED': return 'Terlalu banyak permintaan kode. Coba lagi nanti.'
    case 'SUSPENDED': return 'Pengiriman kode ditangguhkan sementara karena terlalu banyak kode salah.'
  }
}

export function sendFailure(code: string): string {
  switch (code) {
    case 'NOT_ON_WHATSAPP': return 'Nomor itu tidak terdaftar di WhatsApp.'
    case 'RATE_LIMITED': return 'Batas pengiriman pesan sistem tercapai. Coba lagi nanti.'
    case 'INVALID_NUMBER': return 'Nomor tidak valid.'
    default: return 'Kode tidak bisa dikirim: WhatsApp belum terhubung.'
  }
}
