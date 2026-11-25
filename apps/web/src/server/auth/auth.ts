import { REAUTH_WINDOW_MS } from '@autobot/contracts/rpc-policy'
import type { AuthDb } from './db'
import { safeEqual, type Keys } from './crypto'
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from './password'
import { RateWindow, Throttle, type Clock } from './throttle'
import type { OtpService } from './otp'
import { RECOVERY_WARN_AT, type RecoveryCodes } from './recovery'
import type { Session, Sessions } from './sessions'
import type { Audit } from './audit'
import { newTotpSecret, otpauthUri, verifyTotp } from './totp'
import { otpMessage, sendFailure, validPhone } from './setup'
import { fail, maskPhone, type Ctx, type Out, type UserRow, type WorkerPort } from './types'

export interface AuthDeps {
  db: AuthDb; keys: Keys; clock: Clock; sessions: Sessions; throttle: Throttle; rate: RateWindow
  otp: OtpService; recovery: RecoveryCodes; audit: Audit; worker: WorkerPort
}

const BAD_LOGIN = 'Username atau password salah.'
const THROTTLED = 'Terlalu banyak percobaan. Coba lagi nanti.'

/**
 * Everything after the account exists: signing in with a password and an authenticator code, recovery codes, resetting a
 * forgotten password through WhatsApp, and the changes that ask the owner to prove themselves again.
 */
export class AuthService {
  constructor(private d: AuthDeps) {}

  user(): UserRow | null {
    return (this.d.db.prepare('SELECT * FROM users WHERE id = 1').get() as UserRow | undefined) ?? null
  }

  /** The signed-in owner behind a session token, or null. */
  owner(token: string | undefined | null, touch = true): Session | null {
    return this.d.sessions.get('owner', token, touch)
  }

  private blocked(keys: string[]): number {
    let wait = 0
    for (const k of keys) {
      const c = this.d.throttle.check(k)
      if (!c.allowed) wait = Math.max(wait, c.retryAfterSec)
    }
    return wait
  }
  private failAll(keys: string[]): void { for (const k of keys) this.d.throttle.fail(k) }
  private resetAll(keys: string[]): void { for (const k of keys) this.d.throttle.reset(k) }

  private totpSecret(u: UserRow): string | null {
    return u.totp_secret_enc ? this.d.keys.open('totp', 'user:1', u.totp_secret_enc) : null
  }

  /** Checks an authenticator code and spends its time step; the same code never works twice, even in parallel requests. */
  private spendTotp(u: UserRow, code: string): boolean {
    const secret = this.totpSecret(u)
    const step = secret ? verifyTotp(secret, String(code), this.d.clock.now(), u.totp_last_step) : null
    if (step === null) return false
    return this.d.db.prepare('UPDATE users SET totp_last_step = ? WHERE id = 1 AND totp_last_step < ?').run(step, step).changes === 1
  }

  // ---- signing in -------------------------------------------------------------------------------------------------

  async login(usernameRaw: string, password: string, ctx: Ctx): Promise<Out<{ pendingToken: string; enroll?: { secret: string; uri: string } }>> {
    const keys = [`login:ip:${ctx.ipHash}`, 'login:acct']
    const wait = this.blocked(keys)
    if (wait) return fail('THROTTLED', THROTTLED, wait)
    const u = this.user()
    const name = String(usernameRaw).trim().toLowerCase()
    const known = !!u && safeEqual(name, u.username)
    const passwordOk = known ? await verifyPassword(u.password_hash, String(password)) : await burnPasswordCheck(String(password))
    if (!known || !passwordOk) {
      this.failAll(keys)
      this.d.audit.log('login_failed', { ipHash: ctx.ipHash })
      return fail('BAD_CREDENTIALS', BAD_LOGIN)
    }
    this.d.sessions.revokeKind('pending')
    const secret = this.totpSecret(u)
    if (!secret) {
      // the authenticator was reset on the server: set a new one up now that the password is right
      const fresh = newTotpSecret()
      const p = this.d.sessions.create('pending', { ipHash: ctx.ipHash, userAgent: ctx.userAgent, data: { enroll: fresh } })
      this.d.audit.log('login_password_ok_enroll', { actor: u.username, ipHash: ctx.ipHash })
      return { ok: true, pendingToken: p.token, enroll: { secret: fresh, uri: otpauthUri(fresh, u.username) } }
    }
    const p = this.d.sessions.create('pending', { ipHash: ctx.ipHash, userAgent: ctx.userAgent })
    this.d.audit.log('login_password_ok', { actor: u.username, ipHash: ctx.ipHash })
    return { ok: true, pendingToken: p.token }
  }

  /** Second step: the authenticator code (or, for an authenticator being set up again, its first code). */
  verifyTotpLogin(pendingToken: string | undefined, code: string, ctx: Ctx): Out<{ sessionToken: string; recoveryRemaining: number }> {
    const keys = [`totp:ip:${ctx.ipHash}`, 'totp:acct']
    const wait = this.blocked(keys)
    if (wait) return fail('THROTTLED', THROTTLED, wait)
    const pending = this.d.sessions.get('pending', pendingToken)
    const u = this.user()
    if (!pending || !u) return fail('SESSION_EXPIRED', 'Sesi masuk habis. Mulai lagi dari username dan password.')
    const enrol = typeof pending.data?.enroll === 'string' ? pending.data.enroll : null
    let ok: boolean
    if (enrol) {
      const step = verifyTotp(enrol, String(code), this.d.clock.now(), 0)
      ok = step !== null
      if (ok) this.d.db.prepare('UPDATE users SET totp_secret_enc = ?, totp_last_step = ? WHERE id = 1').run(this.d.keys.seal('totp', 'user:1', enrol), step)
    } else {
      ok = this.spendTotp(u, code)
    }
    if (!ok) {
      this.failAll(keys)
      this.d.audit.log('totp_failed', { actor: u.username, ipHash: ctx.ipHash })
      return fail('INVALID_CODE', 'Kode authenticator salah.')
    }
    return this.signIn(u, pendingToken as string, ctx, false)
  }

  /** The authenticator is unavailable: a recovery code stands in, and the session may only set up a new authenticator. */
  loginWithRecovery(pendingToken: string | undefined, recoveryCode: string, ctx: Ctx): Out<{ sessionToken: string; recoveryRemaining: number }> {
    const keys = [`recovery:ip:${ctx.ipHash}`, 'recovery:acct']
    const wait = this.blocked(keys)
    if (wait) return fail('THROTTLED', THROTTLED, wait)
    const pending = this.d.sessions.get('pending', pendingToken)
    const u = this.user()
    if (!pending || !u) return fail('SESSION_EXPIRED', 'Sesi masuk habis. Mulai lagi dari username dan password.')
    if (!this.d.recovery.use(String(recoveryCode))) {
      this.failAll(keys)
      this.d.audit.log('recovery_failed', { actor: u.username, ipHash: ctx.ipHash })
      return fail('INVALID_CODE', 'Kode pemulihan salah atau sudah dipakai.')
    }
    this.d.audit.log('login_recovery', { actor: u.username, ipHash: ctx.ipHash })
    return this.signIn(u, pendingToken as string, ctx, true)
  }

  private signIn(u: UserRow, pendingToken: string, ctx: Ctx, restricted: boolean): Out<{ sessionToken: string; recoveryRemaining: number }> {
    this.d.sessions.revoke(pendingToken)
    this.resetAll([`login:ip:${ctx.ipHash}`, 'login:acct', `totp:ip:${ctx.ipHash}`, 'totp:acct', `recovery:ip:${ctx.ipHash}`, 'recovery:acct'])
    const s = this.d.sessions.create('owner', { ipHash: ctx.ipHash, userAgent: ctx.userAgent, restricted })
    if (!restricted) this.d.audit.log('login_ok', { actor: u.username, ipHash: ctx.ipHash })
    return { ok: true, sessionToken: s.token, recoveryRemaining: this.d.recovery.remaining() }
  }

  logout(token: string | undefined): void {
    if (token) this.d.sessions.revoke(token)
  }
  logoutAll(session: Session): void {
    this.d.sessions.revokeAll()
    this.d.audit.log('logout_all', { actor: this.user()?.username })
    void session
  }

  // ---- proving yourself again ---------------------------------------------------------------------------------------

  async reauth(session: Session, password: string, ctx: Ctx): Promise<Out> {
    const keys = [`reauth:ip:${ctx.ipHash}`, 'reauth:acct']
    const wait = this.blocked(keys)
    if (wait) return fail('THROTTLED', THROTTLED, wait)
    const u = this.user()
    if (!u || !(await verifyPassword(u.password_hash, String(password)))) {
      this.failAll(keys)
      return fail('BAD_CREDENTIALS', 'Password salah.')
    }
    this.resetAll(keys)
    this.d.sessions.markReauth(session.idHash)
    return { ok: true }
  }

  /** True when the owner entered the password in the last ten minutes. */
  recentlyReauthed(session: Session): boolean {
    return session.reauthAt !== null && this.d.clock.now() - session.reauthAt < REAUTH_WINDOW_MS
  }

  /** Password and authenticator code together: for changes that must not happen on a stolen, already-open session. */
  private async strong(password: string, totp: string, ctx: Ctx): Promise<Out<{ user: UserRow }>> {
    const keys = [`strong:ip:${ctx.ipHash}`, 'strong:acct']
    const wait = this.blocked(keys)
    if (wait) return fail('THROTTLED', THROTTLED, wait)
    const u = this.user()
    const okPw = u ? await verifyPassword(u.password_hash, String(password)) : false
    const okTotp = u && okPw ? this.spendTotp(u, totp) : false
    if (!u || !okPw || !okTotp) {
      this.failAll(keys)
      this.d.audit.log('step_up_failed', { actor: u?.username, ipHash: ctx.ipHash })
      return fail('BAD_CREDENTIALS', 'Password atau kode authenticator salah.')
    }
    this.resetAll(keys)
    return { ok: true, user: u }
  }

  // ---- changing credentials -----------------------------------------------------------------------------------------

  async changePassword(session: Session, oldPassword: string, totp: string, newPassword: string, ctx: Ctx): Promise<Out<{ sessionToken: string }>> {
    const s = await this.strong(oldPassword, totp, ctx)
    if (!s.ok) return s
    const problem = passwordProblem(String(newPassword), s.user.username)
    if (problem) return fail('VALIDATION', problem)
    const hash = await hashPassword(String(newPassword))
    this.d.db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = 1').run(hash, this.d.clock.now())
    // every other device is signed out, and this one gets a fresh token
    this.d.sessions.revokeAll()
    const fresh = this.d.sessions.create('owner', { ipHash: ctx.ipHash, userAgent: ctx.userAgent })
    this.d.audit.log('password_changed', { actor: s.user.username, ipHash: ctx.ipHash })
    this.notify(s.user.owner_phone, { kind: 'notice_password_changed', username: s.user.username })
    void session
    return { ok: true, sessionToken: fresh.token }
  }

  async regenerateRecovery(password: string, totp: string, ctx: Ctx): Promise<Out<{ recoveryCodes: string[] }>> {
    const s = await this.strong(password, totp, ctx)
    if (!s.ok) return s
    const { shown, hmacs } = this.d.recovery.generate()
    this.d.recovery.replaceAll(hmacs)
    this.d.audit.log('recovery_regenerated', { actor: s.user.username, ipHash: ctx.ipHash })
    return { ok: true, recoveryCodes: shown }
  }

  /** Start setting up the authenticator again (after a recovery-code login, or on request). Returns the new secret. */
  async startTotpEnroll(session: Session, password: string | null, totp: string | null, ctx: Ctx): Promise<Out<{ secret: string; uri: string }>> {
    const u = this.user()
    if (!u) return fail('SESSION_EXPIRED', 'Sesi habis.')
    if (!session.restricted) {
      const s = await this.strong(password ?? '', totp ?? '', ctx)
      if (!s.ok) return s
    }
    const secret = newTotpSecret()
    this.d.sessions.setData(session.idHash, { enroll: secret })
    return { ok: true, secret, uri: otpauthUri(secret, u.username) }
  }

  confirmTotpEnroll(session: Session, code: string, ctx: Ctx): Out {
    const u = this.user()
    if (!u) return fail('SESSION_EXPIRED', 'Sesi habis.')
    const secret = typeof session.data?.enroll === 'string' ? session.data.enroll : null
    if (!secret) return fail('FORBIDDEN', 'Mulai pendaftaran authenticator dulu.')
    const keys = [`totp:ip:${ctx.ipHash}`, 'totp:acct']
    const wait = this.blocked(keys)
    if (wait) return fail('THROTTLED', THROTTLED, wait)
    const step = verifyTotp(secret, String(code), this.d.clock.now(), 0)
    if (step === null) { this.failAll(keys); return fail('INVALID_CODE', 'Kode authenticator salah.') }
    this.d.db.prepare('UPDATE users SET totp_secret_enc = ?, totp_last_step = ? WHERE id = 1').run(this.d.keys.seal('totp', 'user:1', secret), step)
    this.d.sessions.setData(session.idHash, null)
    this.d.sessions.setRestricted(session.idHash, false)
    this.d.audit.log('totp_enrolled', { actor: u.username, ipHash: ctx.ipHash })
    return { ok: true }
  }

  /** Change the number that receives verification codes: the new number must prove itself with a code. */
  async changePhoneStart(session: Session, password: string, totp: string, newPhoneRaw: string, ctx: Ctx): Promise<Out<{ sentTo: string }>> {
    const s = await this.strong(password, totp, ctx)
    if (!s.ok) return s
    const phone = validPhone(newPhoneRaw)
    if (!phone) return fail('VALIDATION', 'Nomor tidak valid. Tulis dengan kode negara, misalnya 62812xxxxxxx.')
    if (phone === s.user.owner_phone) return fail('VALIDATION', 'Itu sudah nomor pemilik saat ini.')
    const bot = await this.d.worker.selfNumber().catch(() => null)
    if (!bot) return fail('WA_UNAVAILABLE', 'WhatsApp belum terhubung, kode tidak bisa dikirim.')
    if (bot === phone) return fail('VALIDATION', 'Nomor pemilik harus berbeda dari nomor WhatsApp yang dipakai bot.')
    const issued = this.d.otp.issue('change_phone', phone)
    if (!issued.ok) return fail('OTP_UNAVAILABLE', otpMessage(issued.reason), issued.retryAfterSec)
    const sent = await this.d.worker.systemSend({ to: phone, kind: 'otp_change_phone', code: issued.code }).catch(() => ({ ok: false as const, code: 'WA_DISCONNECTED' }))
    if (!sent.ok) return fail('WA_UNAVAILABLE', sendFailure(sent.code))
    this.d.sessions.setData(session.idHash, { newPhone: phone })
    return { ok: true, sentTo: maskPhone(phone) }
  }

  changePhoneConfirm(session: Session, code: string, ctx: Ctx): Out {
    const u = this.user()
    const phone = typeof session.data?.newPhone === 'string' ? session.data.newPhone : null
    if (!u || !phone) return fail('FORBIDDEN', 'Mulai penggantian nomor dulu.')
    const r = this.d.otp.verify('change_phone', phone, String(code))
    if (!r.ok) return fail(r.reason === 'SUSPENDED' ? 'OTP_UNAVAILABLE' : 'INVALID_CODE', r.reason === 'SUSPENDED' ? 'Terlalu banyak kode salah. Coba lagi dalam satu jam.' : 'Kode salah atau sudah kedaluwarsa.')
    this.d.db.prepare('UPDATE users SET owner_phone = ? WHERE id = 1').run(phone)
    this.d.sessions.setData(session.idHash, null)
    this.d.audit.log('owner_phone_changed', { actor: u.username, ipHash: ctx.ipHash })
    this.notify(u.owner_phone, { kind: 'notice_phone_changed', last4: phone.slice(-4) })
    return { ok: true }
  }

  // ---- forgotten password ---------------------------------------------------------------------------------------------

  /**
   * Always answers the same way, whether or not the username matches and whether or not WhatsApp is connected, so nobody
   * can use this to learn anything. The message is sent after the answer, so timing says nothing either.
   */
  forgot(usernameRaw: string, ctx: Ctx): { response: Out<{ message: string }>; background: Promise<void> } {
    const uniform: Out<{ message: string }> = { ok: true, message: 'Jika data cocok dan WhatsApp terhubung, kode sudah dikirim ke WhatsApp pemilik.' }
    const keys = [`forgot:ip:${ctx.ipHash}`]
    const wait = this.blocked(keys)
    if (wait) return { response: fail('THROTTLED', THROTTLED, wait), background: Promise.resolve() }
    this.d.throttle.fail(keys[0]) // every request counts, so the address cannot be used to flood the owner's phone
    const u = this.user()
    if (!u || !safeEqual(String(usernameRaw).trim().toLowerCase(), u.username)) return { response: uniform, background: Promise.resolve() }
    const issued = this.d.otp.issue('reset', u.owner_phone)
    this.d.audit.log('forgot_requested', { actor: u.username, ipHash: ctx.ipHash, detail: { issued: issued.ok } })
    if (!issued.ok) return { response: uniform, background: Promise.resolve() }
    const background = this.d.worker
      .systemSend({ to: u.owner_phone, kind: 'otp_reset', code: issued.code })
      .then((r) => { if (!r.ok) this.d.audit.log('forgot_send_failed', { actor: u.username, detail: { reason: r.code } }) })
      .catch(() => this.d.audit.log('forgot_send_failed', { actor: u.username, detail: { reason: 'WORKER_DOWN' } }))
    return { response: uniform, background }
  }

  /** A code from WhatsApp, or a recovery code when WhatsApp is not an option, earns a short-lived right to set a new password. */
  forgotVerify(input: { code?: string; recoveryCode?: string }, ctx: Ctx): Out<{ resetToken: string }> {
    const keys = [`forgot-verify:ip:${ctx.ipHash}`, 'forgot-verify:acct']
    const wait = this.blocked(keys)
    if (wait) return fail('THROTTLED', THROTTLED, wait)
    const u = this.user()
    if (!u) return fail('INVALID_CODE', 'Kode salah atau sudah kedaluwarsa.')
    let ok = false
    if (typeof input.recoveryCode === 'string' && input.recoveryCode) ok = this.d.recovery.use(input.recoveryCode)
    else if (typeof input.code === 'string') {
      const r = this.d.otp.verify('reset', u.owner_phone, input.code)
      if (!r.ok && r.reason === 'SUSPENDED') return fail('OTP_UNAVAILABLE', 'Terlalu banyak kode salah. Pakai kode pemulihan, atau coba lagi dalam satu jam.', 3600)
      ok = r.ok
    }
    if (!ok) {
      this.failAll(keys)
      this.d.audit.log('forgot_verify_failed', { actor: u.username, ipHash: ctx.ipHash })
      return fail('INVALID_CODE', 'Kode salah atau sudah kedaluwarsa.')
    }
    this.resetAll(keys)
    this.d.sessions.revokeKind('reset')
    const s = this.d.sessions.create('reset', { ipHash: ctx.ipHash, userAgent: ctx.userAgent })
    this.d.audit.log('forgot_verified', { actor: u.username, ipHash: ctx.ipHash, detail: { via: input.recoveryCode ? 'recovery' : 'otp' } })
    return { ok: true, resetToken: s.token }
  }

  /** Sets the new password. Signs everyone out and does NOT sign anyone in: the authenticator code is still needed. */
  async forgotReset(resetToken: string | undefined, newPassword: string, ctx: Ctx): Promise<Out> {
    const s = this.d.sessions.get('reset', resetToken)
    const u = this.user()
    if (!s || !u) return fail('SESSION_EXPIRED', 'Waktu habis. Minta kode lagi.')
    const problem = passwordProblem(String(newPassword), u.username)
    if (problem) return fail('VALIDATION', problem)
    const hash = await hashPassword(String(newPassword))
    this.d.db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = 1').run(hash, this.d.clock.now())
    this.d.sessions.revokeAll()
    this.d.audit.log('password_reset', { actor: u.username, ipHash: ctx.ipHash })
    this.notify(u.owner_phone, { kind: 'notice_password_changed', username: u.username })
    return { ok: true }
  }

  // ---- sessions -----------------------------------------------------------------------------------------------------

  devices(session: Session): { id: string; createdAt: number; lastSeenAt: number; userAgent: string | null; current: boolean }[] {
    return this.d.sessions.listOwner().map((x) => ({ id: x.id, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, userAgent: x.userAgent, current: x.idHash === session.idHash }))
  }
  revokeDevice(session: Session, shortId: string): Out {
    return this.d.sessions.revokeByShortId(shortId, session.idHash) ? { ok: true } : fail('NOT_FOUND', 'Perangkat tidak ditemukan.')
  }

  /** Sends a notice in the background; a failure only goes to the audit log, it never blocks the change. */
  private notify(to: string, req: { kind: string; username?: string; last4?: string }): void {
    void this.d.worker
      .systemSend({ to, ...req })
      .then((r) => { if (!r.ok) this.d.audit.log('notice_failed', { detail: { kind: req.kind, reason: r.code } }) })
      .catch(() => this.d.audit.log('notice_failed', { detail: { kind: req.kind, reason: 'WORKER_DOWN' } }))
  }

  recoveryWarning(): boolean {
    return this.d.recovery.remaining() <= RECOVERY_WARN_AT
  }
}
