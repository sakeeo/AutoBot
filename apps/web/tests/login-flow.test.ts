import { describe, it, expect } from 'vitest'
import { createOwner, ctx, makeEnv, OWNER_PHONE, type Env } from './helpers'
import { RECOVERY_COUNT } from '../src/server/auth/recovery'

async function setup(o: Parameters<typeof createOwner>[1] = {}) {
  const env = makeEnv()
  const owner = await createOwner(env, o)
  env.sys.auth.logout(owner.sessionToken) // the wizard ends signed in; these tests start from a signed-out owner
  // past the 60-second pause between codes to the same phone, and onto a fresh authenticator step
  env.clock.advance(61_000)
  return { env, owner }
}
/** Signs in the normal way: password, then the authenticator code for "now". */
async function signIn(env: Env, owner: { username: string; password: string; secret: string }, c = ctx()) {
  const a = await env.sys.auth.login(owner.username, owner.password, c)
  if (!a.ok) throw new Error(a.message)
  const b = env.sys.auth.verifyTotpLogin(a.pendingToken, env.codeFor(owner.secret), c)
  if (!b.ok) throw new Error(b.message)
  return b.sessionToken
}

describe('login: password, then authenticator code', () => {
  it('signs in with the right password and the right code', async () => {
    const { env, owner } = await setup()
    const token = await signIn(env, owner)
    expect(env.sys.auth.owner(token)).not.toBeNull()
    expect(env.sys.audit.recent().map((r) => r.action)).toContain('login_ok')
  })
  it('a right password alone gives no session: the pending step is not a session', async () => {
    const { env, owner } = await setup()
    const a = await env.sys.auth.login(owner.username, owner.password, ctx())
    if (!a.ok) throw new Error()
    expect(env.sys.auth.owner(a.pendingToken)).toBeNull()
    expect(env.sys.sessions.get('owner', a.pendingToken)).toBeNull()
    expect(env.db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE kind = 'owner'").get()).toEqual({ c: 0 })
  })
  it('gives the same answer for a wrong password and an unknown username', async () => {
    const { env, owner } = await setup()
    const wrongPw = await env.sys.auth.login(owner.username, 'bukan-sandi-yang-benar-sama-sekali', ctx('1.1.1.1'))
    const wrongUser = await env.sys.auth.login('orang-lain', owner.password, ctx('2.2.2.2'))
    expect(wrongPw).toEqual(wrongUser)
    expect(wrongPw).toMatchObject({ ok: false, code: 'BAD_CREDENTIALS', message: 'Username atau password salah.' })
  })
  it('treats the username without regard to case or surrounding spaces', async () => {
    const { env, owner } = await setup()
    expect((await env.sys.auth.login('  BUDI ', owner.password, ctx())).ok).toBe(true)
  })
  it('slows down after five failures, doubles the wait, and a good sign-in clears it', async () => {
    const { env, owner } = await setup()
    for (let i = 0; i < 5; i++) await env.sys.auth.login(owner.username, 'salah-salah-salah-salah', ctx())
    const blocked = await env.sys.auth.login(owner.username, owner.password, ctx()) // even the right password waits
    expect(blocked).toMatchObject({ ok: false, code: 'THROTTLED', retryAfterSec: 60 })
    env.clock.advance(61_000)
    expect((await env.sys.auth.login(owner.username, owner.password, ctx())).ok).toBe(true)
  })
  it('an attacker from another address cannot lock the owner out of their own address... but the account key still slows everyone', async () => {
    const { env, owner } = await setup()
    for (let i = 0; i < 5; i++) await env.sys.auth.login(owner.username, 'salah-salah-salah-salah', ctx('6.6.6.6'))
    // never a permanent lock: after the wait the owner gets in, from anywhere
    env.clock.advance(61_000)
    expect((await env.sys.auth.login(owner.username, owner.password, ctx('7.7.7.7'))).ok).toBe(true)
  })
  it('rejects a wrong authenticator code, counts it, and does not sign in', async () => {
    const { env, owner } = await setup()
    const a = await env.sys.auth.login(owner.username, owner.password, ctx()); if (!a.ok) throw new Error()
    expect(env.sys.auth.verifyTotpLogin(a.pendingToken, '000000', ctx())).toMatchObject({ ok: false, code: 'INVALID_CODE' })
    for (let i = 0; i < 4; i++) env.sys.auth.verifyTotpLogin(a.pendingToken, '000000', ctx())
    expect(env.sys.auth.verifyTotpLogin(a.pendingToken, env.codeFor(owner.secret), ctx())).toMatchObject({ ok: false, code: 'THROTTLED' })
  })
  it('never accepts the same authenticator code twice, not even a code the wizard already used', async () => {
    const { env, owner } = await setup()
    const first = await env.sys.auth.login(owner.username, owner.password, ctx('1.1.1.1')); if (!first.ok) throw new Error()
    const code = env.codeFor(owner.secret)
    expect(env.sys.auth.verifyTotpLogin(first.pendingToken, code, ctx('1.1.1.1')).ok).toBe(true)
    const second = await env.sys.auth.login(owner.username, owner.password, ctx('2.2.2.2')); if (!second.ok) throw new Error()
    expect(env.sys.auth.verifyTotpLogin(second.pendingToken, code, ctx('2.2.2.2'))).toMatchObject({ ok: false, code: 'INVALID_CODE' })
    env.clock.advance(30_000)
    expect(env.sys.auth.verifyTotpLogin(second.pendingToken, env.codeFor(owner.secret), ctx('2.2.2.2')).ok).toBe(true)
  })
  it('the pending step expires after five minutes, and a pending token cannot be reused after signing in', async () => {
    const { env, owner } = await setup()
    const a = await env.sys.auth.login(owner.username, owner.password, ctx()); if (!a.ok) throw new Error()
    env.clock.advance(5 * 60_000 + 1)
    expect(env.sys.auth.verifyTotpLogin(a.pendingToken, env.codeFor(owner.secret), ctx())).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' })
    const b = await env.sys.auth.login(owner.username, owner.password, ctx()); if (!b.ok) throw new Error()
    expect(env.sys.auth.verifyTotpLogin(b.pendingToken, env.codeFor(owner.secret), ctx()).ok).toBe(true)
    env.clock.advance(30_000)
    expect(env.sys.auth.verifyTotpLogin(b.pendingToken, env.codeFor(owner.secret), ctx())).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' })
  })
  it('works while WhatsApp is down: signing in never needs it', async () => {
    const { env, owner } = await setup()
    env.worker.down = true; env.worker.self = null
    expect(env.sys.auth.owner(await signIn(env, owner))).not.toBeNull()
  })
  it('ends the session after 30 idle minutes', async () => {
    const { env, owner } = await setup()
    const token = await signIn(env, owner)
    env.clock.advance(31 * 60_000)
    expect(env.sys.auth.owner(token)).toBeNull()
  })
  it('logout ends that session only; "sign out everywhere" ends all of them', async () => {
    const { env, owner } = await setup()
    const a = await signIn(env, owner, ctx('1.1.1.1')); env.clock.advance(30_000)
    const b = await signIn(env, owner, ctx('2.2.2.2'))
    env.sys.auth.logout(a)
    expect(env.sys.auth.owner(a)).toBeNull()
    expect(env.sys.auth.owner(b)).not.toBeNull()
    env.sys.auth.logoutAll(env.sys.auth.owner(b)!)
    expect(env.sys.auth.owner(b)).toBeNull()
  })
})

describe('recovery codes', () => {
  it('a recovery code stands in for the authenticator, works once, and limits the session to setting up a new authenticator', async () => {
    const { env, owner } = await setup()
    const a = await env.sys.auth.login(owner.username, owner.password, ctx()); if (!a.ok) throw new Error()
    const r = env.sys.auth.loginWithRecovery(a.pendingToken, owner.recoveryCodes[0], ctx())
    expect(r).toMatchObject({ ok: true, recoveryRemaining: RECOVERY_COUNT - 1 })
    if (!r.ok) throw new Error()
    expect(env.sys.auth.owner(r.sessionToken)).toMatchObject({ restricted: true })
    const again = await env.sys.auth.login(owner.username, owner.password, ctx('3.3.3.3')); if (!again.ok) throw new Error()
    expect(env.sys.auth.loginWithRecovery(again.pendingToken, owner.recoveryCodes[0], ctx('3.3.3.3'))).toMatchObject({ ok: false, code: 'INVALID_CODE' })
  })
  it('after a recovery login the owner sets up a new authenticator, the old one stops working, and the session opens up', async () => {
    const { env, owner } = await setup()
    const a = await env.sys.auth.login(owner.username, owner.password, ctx()); if (!a.ok) throw new Error()
    const r = env.sys.auth.loginWithRecovery(a.pendingToken, owner.recoveryCodes[1], ctx()); if (!r.ok) throw new Error()
    const session = env.sys.auth.owner(r.sessionToken)!
    const start = await env.sys.auth.startTotpEnroll(session, null, null, ctx()); if (!start.ok) throw new Error(start.message)
    const fresh = env.sys.auth.owner(r.sessionToken)!
    expect(env.sys.auth.confirmTotpEnroll(fresh, '000000', ctx())).toMatchObject({ ok: false, code: 'INVALID_CODE' })
    expect(env.sys.auth.confirmTotpEnroll(fresh, env.codeFor(start.secret), ctx()).ok).toBe(true)
    expect(env.sys.auth.owner(r.sessionToken)).toMatchObject({ restricted: false })
    env.clock.advance(30_000)
    const login = await env.sys.auth.login(owner.username, owner.password, ctx('4.4.4.4')); if (!login.ok) throw new Error()
    expect(env.sys.auth.verifyTotpLogin(login.pendingToken, env.codeFor(owner.secret), ctx('4.4.4.4')).ok).toBe(false) // old secret
    expect(env.sys.auth.verifyTotpLogin(login.pendingToken, env.codeFor(start.secret), ctx('4.4.4.4')).ok).toBe(true)
  })
  it('a normal session needs password and a code to start over; a wrong pair is refused', async () => {
    const { env, owner } = await setup()
    const session = env.sys.auth.owner(await signIn(env, owner))!
    expect(await env.sys.auth.startTotpEnroll(session, owner.password, '000000', ctx())).toMatchObject({ ok: false, code: 'BAD_CREDENTIALS' })
    env.clock.advance(30_000)
    expect((await env.sys.auth.startTotpEnroll(session, owner.password, env.codeFor(owner.secret), ctx())).ok).toBe(true)
  })
  it('regenerating makes ten new codes and kills the old ones, but only with password and a code', async () => {
    const { env, owner } = await setup()
    const token = await signIn(env, owner)
    expect(await env.sys.auth.regenerateRecovery(owner.password, '000000', ctx())).toMatchObject({ ok: false })
    env.clock.advance(30_000)
    const r = await env.sys.auth.regenerateRecovery(owner.password, env.codeFor(owner.secret), ctx())
    if (!r.ok) throw new Error(r.message)
    expect(r.recoveryCodes).toHaveLength(RECOVERY_COUNT)
    expect(env.sys.recovery.use(owner.recoveryCodes[2])).toBe(false)
    expect(env.sys.recovery.use(r.recoveryCodes[2])).toBe(true)
    void token
  })
  it('a wrong recovery code is counted and eventually slowed', async () => {
    const { env, owner } = await setup()
    const a = await env.sys.auth.login(owner.username, owner.password, ctx()); if (!a.ok) throw new Error()
    for (let i = 0; i < 5; i++) env.sys.auth.loginWithRecovery(a.pendingToken, 'AAAAA-AAAAA', ctx())
    expect(env.sys.auth.loginWithRecovery(a.pendingToken, owner.recoveryCodes[0], ctx())).toMatchObject({ ok: false, code: 'THROTTLED' })
  })
})

describe('an authenticator reset on the server', () => {
  it('asks for a new authenticator after the password, and the first code signs in', async () => {
    const { env, owner } = await setup()
    env.db.prepare('UPDATE users SET totp_secret_enc = NULL').run() // what `reset-totp` does
    const a = await env.sys.auth.login(owner.username, owner.password, ctx()); if (!a.ok) throw new Error()
    expect(a.enroll?.uri).toMatch(/^otpauth:\/\/totp\/AutoBot:budi/)
    expect(env.sys.auth.verifyTotpLogin(a.pendingToken, '000000', ctx()).ok).toBe(false)
    const ok = env.sys.auth.verifyTotpLogin(a.pendingToken, env.codeFor(a.enroll!.secret), ctx())
    expect(ok.ok).toBe(true)
    env.clock.advance(30_000)
    const again = await env.sys.auth.login(owner.username, owner.password, ctx('9.9.9.9')); if (!again.ok) throw new Error()
    expect(again.enroll).toBeUndefined()
    expect(env.sys.auth.verifyTotpLogin(again.pendingToken, env.codeFor(a.enroll!.secret), ctx('9.9.9.9')).ok).toBe(true)
  })
})

describe('forgotten password (code through WhatsApp)', () => {
  it('answers the same whether the username exists or not, and only a real one sends a code', async () => {
    const { env, owner } = await setup()
    const real = env.sys.auth.forgot(owner.username, ctx('1.1.1.1')); await real.background
    const fake = env.sys.auth.forgot('tidak-ada', ctx('2.2.2.2')); await fake.background
    expect(real.response).toEqual(fake.response)
    expect(env.worker.sent).toEqual([{ to: OWNER_PHONE, kind: 'otp_reset', code: expect.stringMatching(/^\d{6}$/) }])
  })
  it('gives the same answer even when WhatsApp is down or the limits are used up', async () => {
    const { env, owner } = await setup()
    env.worker.down = true
    const a = env.sys.auth.forgot(owner.username, ctx('1.1.1.1')); await a.background
    env.worker.down = false
    for (let i = 0; i < 3; i++) { env.clock.advance(61_000); const r = env.sys.auth.forgot(owner.username, ctx(`3.3.3.${i}`)); await r.background }
    const limited = env.sys.auth.forgot(owner.username, ctx('4.4.4.4')); await limited.background
    expect(limited.response).toEqual(a.response)
    expect(env.sys.audit.recent(50).some((r) => r.action === 'forgot_send_failed')).toBe(true)
  })
  it('sets a new password with the code, signs everyone out, signs nobody in, and keeps the authenticator', async () => {
    const { env, owner } = await setup()
    const live = await signIn(env, owner)
    const f = env.sys.auth.forgot(owner.username, ctx()); await f.background
    const v = env.sys.auth.forgotVerify({ code: env.worker.last('otp_reset')!.code! }, ctx())
    if (!v.ok) throw new Error(v.message)
    expect(env.sys.auth.owner(live)).not.toBeNull() // verifying alone changes nothing
    const reset = await env.sys.auth.forgotReset(v.resetToken, 'sandi baru yang cukup panjang ya', ctx())
    expect(reset.ok).toBe(true)
    expect(env.sys.auth.owner(live)).toBeNull() // every session ended
    expect(env.db.prepare('SELECT COUNT(*) AS c FROM sessions').get()).toEqual({ c: 0 }) // and none was created
    expect((await env.sys.auth.login(owner.username, owner.password, ctx('5.5.5.5'))).ok).toBe(false) // old password
    const n = await env.sys.auth.login(owner.username, 'sandi baru yang cukup panjang ya', ctx('6.6.6.6')); if (!n.ok) throw new Error()
    env.clock.advance(30_000)
    expect(env.sys.auth.verifyTotpLogin(n.pendingToken, '000000', ctx('6.6.6.6')).ok).toBe(false) // still needs the authenticator
    expect(env.sys.auth.verifyTotpLogin(n.pendingToken, env.codeFor(owner.secret), ctx('6.6.6.6')).ok).toBe(true)
    expect(env.sys.recovery.remaining()).toBe(RECOVERY_COUNT) // recovery codes untouched
  })
  it('tells the owner on WhatsApp that the password changed, without the password or any code', async () => {
    const { env, owner } = await setup()
    const f = env.sys.auth.forgot(owner.username, ctx()); await f.background
    const v = env.sys.auth.forgotVerify({ code: env.worker.last('otp_reset')!.code! }, ctx()); if (!v.ok) throw new Error()
    await env.sys.auth.forgotReset(v.resetToken, 'sandi baru yang cukup panjang ya', ctx())
    await new Promise((r) => setTimeout(r, 0))
    expect(env.worker.last('notice_password_changed')).toEqual({ to: OWNER_PHONE, kind: 'notice_password_changed', username: 'budi' })
  })
  it('the code works once and only for a reset; a setup code or a wrong code does not', async () => {
    const { env, owner } = await setup()
    const f = env.sys.auth.forgot(owner.username, ctx()); await f.background
    const code = env.worker.last('otp_reset')!.code!
    expect(env.sys.auth.forgotVerify({ code: code === '000000' ? '111111' : '000000' }, ctx())).toMatchObject({ ok: false, code: 'INVALID_CODE' })
    expect(env.sys.auth.forgotVerify({ code }, ctx()).ok).toBe(true)
    expect(env.sys.auth.forgotVerify({ code }, ctx()).ok).toBe(false)
  })
  it('a recovery code works instead when WhatsApp is not an option', async () => {
    const { env, owner } = await setup()
    env.worker.down = true
    const v = env.sys.auth.forgotVerify({ recoveryCode: owner.recoveryCodes[3] }, ctx())
    if (!v.ok) throw new Error(v.message)
    expect((await env.sys.auth.forgotReset(v.resetToken, 'sandi baru yang cukup panjang ya', ctx())).ok).toBe(true)
    expect(env.sys.recovery.remaining()).toBe(RECOVERY_COUNT - 1)
  })
  it('the right to reset lasts ten minutes and one use of the token', async () => {
    const { env, owner } = await setup()
    const v = env.sys.auth.forgotVerify({ recoveryCode: owner.recoveryCodes[4] }, ctx()); if (!v.ok) throw new Error()
    env.clock.advance(10 * 60_000 + 1)
    expect(await env.sys.auth.forgotReset(v.resetToken, 'sandi baru yang cukup panjang ya', ctx())).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' })
    const v2 = env.sys.auth.forgotVerify({ recoveryCode: owner.recoveryCodes[5] }, ctx()); if (!v2.ok) throw new Error()
    expect((await env.sys.auth.forgotReset(v2.resetToken, 'sandi baru yang cukup panjang ya', ctx())).ok).toBe(true)
    expect(await env.sys.auth.forgotReset(v2.resetToken, 'sandi lain lagi yang cukup panjang', ctx())).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' })
  })
  it('refuses a weak new password and keeps the old one', async () => {
    const { env, owner } = await setup()
    const v = env.sys.auth.forgotVerify({ recoveryCode: owner.recoveryCodes[6] }, ctx()); if (!v.ok) throw new Error()
    expect(await env.sys.auth.forgotReset(v.resetToken, 'pendek', ctx())).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(await env.sys.auth.forgotReset(v.resetToken, 'budi-budi-budi-budi', ctx())).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect((await env.sys.auth.login(owner.username, owner.password, ctx('8.8.8.8'))).ok).toBe(true)
  })
  it('limits how often a code can be requested from one address, so it cannot flood the owner\'s phone', async () => {
    const { env, owner } = await setup()
    const results: string[] = []
    for (let i = 0; i < 8; i++) { const r = env.sys.auth.forgot(owner.username, ctx('7.7.7.7')); await r.background; results.push(r.response.ok ? 'ok' : (r.response as { code: string }).code); env.clock.advance(61_000) }
    expect(results.filter((r) => r === 'THROTTLED').length).toBeGreaterThan(0)
    expect(env.worker.sent.length).toBeLessThanOrEqual(5)
  })
  it('wrong codes are counted against the address, and an OTP suspension points to the recovery codes', async () => {
    const { env, owner } = await setup()
    for (let i = 0; i < 5; i++) env.sys.auth.forgotVerify({ code: '000000' }, ctx('1.2.3.4'))
    expect(env.sys.auth.forgotVerify({ recoveryCode: owner.recoveryCodes[0] }, ctx('1.2.3.4'))).toMatchObject({ ok: false, code: 'THROTTLED' })
  })
})

describe('changes that ask for proof again', () => {
  it('re-entering the password opens a ten-minute window, and a wrong password does not', async () => {
    const { env, owner } = await setup()
    const token = await signIn(env, owner)
    const session = env.sys.auth.owner(token)!
    expect(env.sys.auth.recentlyReauthed(session)).toBe(false)
    expect(await env.sys.auth.reauth(session, 'salah-salah-salah', ctx())).toMatchObject({ ok: false, code: 'BAD_CREDENTIALS' })
    expect(env.sys.auth.recentlyReauthed(env.sys.auth.owner(token)!)).toBe(false)
    expect((await env.sys.auth.reauth(session, owner.password, ctx())).ok).toBe(true)
    expect(env.sys.auth.recentlyReauthed(env.sys.auth.owner(token)!)).toBe(true)
    env.clock.advance(9 * 60_000)
    expect(env.sys.auth.recentlyReauthed(env.sys.auth.owner(token)!)).toBe(true)
    env.clock.advance(2 * 60_000)
    expect(env.sys.auth.recentlyReauthed(env.sys.auth.owner(token)!)).toBe(false)
  })
  it('changing the password needs the old password AND a code, signs out the other devices, and rotates this token', async () => {
    const { env, owner } = await setup()
    const a = await signIn(env, owner, ctx('1.1.1.1')); env.clock.advance(30_000)
    const b = await signIn(env, owner, ctx('2.2.2.2')); env.clock.advance(30_000)
    const session = env.sys.auth.owner(b)!
    expect(await env.sys.auth.changePassword(session, owner.password, '000000', 'sandi ganti yang cukup panjang', ctx())).toMatchObject({ ok: false, code: 'BAD_CREDENTIALS' })
    expect(await env.sys.auth.changePassword(session, 'salah-salah-salah', env.codeFor(owner.secret), 'sandi ganti yang cukup panjang', ctx())).toMatchObject({ ok: false })
    env.clock.advance(30_000)
    const done = await env.sys.auth.changePassword(session, owner.password, env.codeFor(owner.secret), 'sandi ganti yang cukup panjang', ctx())
    if (!done.ok) throw new Error(done.message)
    expect(env.sys.auth.owner(a)).toBeNull()
    expect(env.sys.auth.owner(b)).toBeNull() // the old token of this device is replaced...
    expect(env.sys.auth.owner(done.sessionToken)).not.toBeNull() // ...by a new one
    await new Promise((r) => setTimeout(r, 0))
    expect(env.worker.last('notice_password_changed')).toBeDefined()
  })
  it('changing the number needs password + code, sends the code to the NEW number, and warns the old one', async () => {
    const { env, owner } = await setup()
    const token = await signIn(env, owner); env.clock.advance(30_000)
    let session = env.sys.auth.owner(token)!
    const start = await env.sys.auth.changePhoneStart(session, owner.password, env.codeFor(owner.secret), '0812 0000 1111', ctx())
    if (!start.ok) throw new Error(start.message)
    expect(env.worker.last('otp_change_phone')).toMatchObject({ to: '6281200001111' })
    expect(env.worker.sent.some((s) => s.to === OWNER_PHONE)).toBe(false)
    session = env.sys.auth.owner(token)!
    expect(env.sys.auth.changePhoneConfirm(session, '000000', ctx())).toMatchObject({ ok: false, code: 'INVALID_CODE' })
    expect(env.sys.auth.changePhoneConfirm(session, env.worker.last('otp_change_phone')!.code!, ctx()).ok).toBe(true)
    expect(env.sys.auth.user()!.owner_phone).toBe('6281200001111')
    await new Promise((r) => setTimeout(r, 0))
    expect(env.worker.last('notice_phone_changed')).toEqual({ to: OWNER_PHONE, kind: 'notice_phone_changed', last4: '1111' })
  })
  it('refuses the bot\'s own number, the current number, and a bad number for the new owner number', async () => {
    const { env, owner } = await setup()
    const token = await signIn(env, owner); env.clock.advance(30_000)
    const session = env.sys.auth.owner(token)!
    for (const n of [env.worker.self!, OWNER_PHONE, 'abc'])
      expect((await env.sys.auth.changePhoneStart(session, owner.password, env.codeFor(owner.secret, env.clock.now()), n, ctx())).ok, n).toBe(false)
  })
  it('lists the devices and signs one out by its short id, never the one in use', async () => {
    const { env, owner } = await setup()
    const a = await signIn(env, owner, ctx('1.1.1.1')); env.clock.advance(30_000)
    const b = await signIn(env, owner, ctx('2.2.2.2'))
    const session = env.sys.auth.owner(b)!
    const list = env.sys.auth.devices(session)
    expect(list).toHaveLength(2)
    expect(list.filter((d) => d.current)).toHaveLength(1)
    const other = list.find((d) => !d.current)!
    expect(env.sys.auth.revokeDevice(session, other.id).ok).toBe(true)
    expect(env.sys.auth.owner(a)).toBeNull()
    expect(env.sys.auth.revokeDevice(session, list.find((d) => d.current)!.id)).toMatchObject({ ok: false })
  })
})
