import { describe, it, expect } from 'vitest'
import { createOwner, ctx, makeEnv, OWNER_PHONE } from './helpers'
import { OTP } from '../src/server/auth/otp'
import { RECOVERY_COUNT } from '../src/server/auth/recovery'

const dbText = (env: ReturnType<typeof makeEnv>) =>
  JSON.stringify(['users', 'setup_state', 'otp_challenges', 'recovery_codes', 'sessions', 'audit_log', 'throttle'].map((t) => env.db.prepare(`SELECT * FROM ${t}`).all()))

describe('setup token', () => {
  it('is made at start, printed once, and only its HMAC is stored', () => {
    const env = makeEnv()
    const token = env.sys.setup.ensureToken()!
    expect(token.length).toBeGreaterThanOrEqual(43) // 32 random bytes
    expect(dbText(env)).not.toContain(token)
  })
  it('lets the right token open a wizard session, and rejects a wrong one', () => {
    const env = makeEnv()
    const token = env.sys.setup.ensureToken()!
    const bad = env.sys.setup.submitToken('salah', ctx())
    expect(bad).toMatchObject({ ok: false, code: 'BAD_CREDENTIALS' })
    const good = env.sys.setup.submitToken(token, ctx())
    expect(good.ok).toBe(true)
    if (good.ok) expect(env.sys.sessions.get('setup', good.sessionToken)).not.toBeNull()
  })
  it('limits guesses to 5 a minute per address and 30 an hour overall', () => {
    const env = makeEnv()
    const token = env.sys.setup.ensureToken()!
    for (let i = 0; i < 5; i++) expect(env.sys.setup.submitToken('x' + i, ctx('1.1.1.1')).ok).toBe(false)
    expect(env.sys.setup.submitToken(token, ctx('1.1.1.1'))).toMatchObject({ ok: false, code: 'THROTTLED' }) // even the right one waits
    expect(env.sys.setup.submitToken(token, ctx('2.2.2.2')).ok).toBe(true) // another address is fine
    env.clock.advance(61_000)
    expect(env.sys.setup.submitToken(token, ctx('1.1.1.1')).ok).toBe(true)
    const e2 = makeEnv(); const t2 = e2.sys.setup.ensureToken()!
    let throttled = 0
    for (let i = 0; i < 40; i++) { const r = e2.sys.setup.submitToken('g' + i, ctx(`9.9.9.${i}`)); if (!r.ok && r.code === 'THROTTLED') throttled++ }
    expect(throttled).toBe(10)
    expect(e2.sys.setup.submitToken(t2, ctx('8.8.8.8'))).toMatchObject({ ok: false, code: 'THROTTLED' })
  })
  it('a restart makes a new token: the old token and the old wizard session stop working', () => {
    const env = makeEnv()
    const t1 = env.sys.setup.ensureToken()!
    const s = env.sys.setup.submitToken(t1, ctx())
    const t2 = env.sys.setup.ensureToken()!
    expect(t2).not.toBe(t1)
    if (s.ok) expect(env.sys.sessions.get('setup', s.sessionToken)).toBeNull()
    expect(env.sys.setup.submitToken(t1, ctx('3.3.3.3')).ok).toBe(false)
    expect(env.sys.setup.submitToken(t2, ctx('3.3.3.3')).ok).toBe(true)
  })
  it('the newest entry wins: an older wizard session ends', () => {
    const env = makeEnv()
    const t = env.sys.setup.ensureToken()!
    const a = env.sys.setup.submitToken(t, ctx('1.1.1.1')); const b = env.sys.setup.submitToken(t, ctx('2.2.2.2'))
    if (a.ok && b.ok) { expect(env.sys.sessions.get('setup', a.sessionToken)).toBeNull(); expect(env.sys.sessions.get('setup', b.sessionToken)).not.toBeNull() }
  })
})

describe('the wizard, step by step', () => {
  it('creates the owner: number first, then WhatsApp code, account, authenticator, recovery codes', async () => {
    const env = makeEnv()
    const o = await createOwner(env)
    const user = env.sys.auth.user()!
    expect(user).toMatchObject({ id: 1, username: 'budi', owner_phone: OWNER_PHONE })
    expect(env.sys.sessions.get('owner', o.sessionToken)).not.toBeNull() // the wizard ends signed in
    expect(o.recoveryCodes).toHaveLength(RECOVERY_COUNT)
    expect(env.sys.recovery.remaining()).toBe(RECOVERY_COUNT)
    expect(env.sys.setup.isComplete()).toBe(true)
    expect(env.db.prepare('SELECT COUNT(*) AS c FROM setup_state').get()).toEqual({ c: 0 })
    expect(env.sys.audit.recent().map((r) => r.action)).toContain('setup_completed')
  })
  it('the code goes to the owner number, never to the bot number, and the text says what it is for', async () => {
    const env = makeEnv()
    const t = env.sys.setup.ensureToken()!; env.sys.setup.submitToken(t, ctx())
    await env.sys.setup.setOwnerPhone('0812-3456-7890')
    const r = await env.sys.setup.sendOwnerOtp(ctx())
    expect(r).toMatchObject({ ok: true, sentTo: '62••••890' })
    expect(env.worker.sent).toEqual([{ to: OWNER_PHONE, kind: 'otp_setup', code: expect.stringMatching(/^\d{6}$/) }])
  })
  it('refuses a number that is the bot\'s own, when choosing it and again when sending', async () => {
    const env = makeEnv()
    env.sys.setup.ensureToken()
    expect(await env.sys.setup.setOwnerPhone(env.worker.self!)).toMatchObject({ ok: false, code: 'VALIDATION', message: expect.stringContaining('berbeda') })
    env.worker.self = null // bot not linked yet: the number is accepted for now
    expect((await env.sys.setup.setOwnerPhone(OWNER_PHONE)).ok).toBe(true)
    env.worker.self = OWNER_PHONE // ...and then the bot is linked with that very number
    expect(await env.sys.setup.sendOwnerOtp(ctx())).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(env.worker.sent).toEqual([])
  })
  it('accepts several ways of writing a number and rejects the nonsense', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    for (const ok of ['081234567890', '+62 812-3456-7890', '6281234567890']) expect((await env.sys.setup.setOwnerPhone(ok)).ok, ok).toBe(true)
    for (const bad of ['', 'abc', '12345', '0', '1234567890123456789']) expect((await env.sys.setup.setOwnerPhone(bad)).ok, bad).toBe(false)
  })
  it('does not send a code while WhatsApp is not connected, and issues none', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE)
    env.worker.self = null
    expect(await env.sys.setup.sendOwnerOtp(ctx())).toMatchObject({ ok: false, code: 'WA_UNAVAILABLE' })
    expect(env.db.prepare('SELECT COUNT(*) AS c FROM otp_challenges').get()).toEqual({ c: 0 })
    env.worker.down = true
    expect(await env.sys.setup.sendOwnerOtp(ctx())).toMatchObject({ ok: false, code: 'WA_UNAVAILABLE' })
  })
  it('explains why a code could not be delivered', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE)
    env.worker.failWith = 'NOT_ON_WHATSAPP'
    expect(await env.sys.setup.sendOwnerOtp(ctx())).toMatchObject({ ok: false, message: 'Nomor itu tidak terdaftar di WhatsApp.' })
  })
  it('keeps the steps in order', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    expect(await env.sys.setup.setAccount('budi', 'kopi susu gula aren tiga sendok')).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(env.sys.setup.verifyTotp('123456', ctx())).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(env.sys.setup.finish(true, ctx())).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(env.sys.setup.verifyOwnerOtp('123456', ctx())).toMatchObject({ ok: false })
  })
  it('changing the number starts verification over', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE)
    await env.sys.setup.sendOwnerOtp(ctx())
    expect(env.sys.setup.verifyOwnerOtp(env.worker.last()!.code!, ctx()).ok).toBe(true)
    expect(env.sys.setup.progress().phoneVerified).toBe(true)
    await env.sys.setup.setOwnerPhone('6281999999999')
    expect(env.sys.setup.progress().phoneVerified).toBe(false)
    expect(await env.sys.setup.setAccount('budi', 'kopi susu gula aren tiga sendok')).toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })
  it('rejects a wrong code, and a code sent for a different number', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE)
    await env.sys.setup.sendOwnerOtp(ctx())
    const code = env.worker.last()!.code!
    expect(env.sys.setup.verifyOwnerOtp(code === '000000' ? '111111' : '000000', ctx())).toMatchObject({ ok: false, code: 'INVALID_CODE' })
    await env.sys.setup.setOwnerPhone('6281999999999') // the old code was for another number
    expect(env.sys.setup.verifyOwnerOtp(code, ctx()).ok).toBe(false)
  })
  it('enforces the send limits on the wizard too: 60-second pause', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE)
    expect((await env.sys.setup.sendOwnerOtp(ctx())).ok).toBe(true)
    expect(await env.sys.setup.sendOwnerOtp(ctx())).toMatchObject({ ok: false, code: 'OTP_UNAVAILABLE' })
    expect(env.worker.sent).toHaveLength(1)
    env.clock.advance(OTP.cooldownMs + 1)
    expect((await env.sys.setup.sendOwnerOtp(ctx())).ok).toBe(true)
  })
  it('validates username and password', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE); await env.sys.setup.sendOwnerOtp(ctx())
    env.sys.setup.verifyOwnerOtp(env.worker.last()!.code!, ctx())
    for (const [u, p] of [['A', 'kopi susu gula aren tiga sendok'], ['budi baik', 'kopi susu gula aren tiga sendok'], ['budi', 'pendek'], ['budi', 'budi-budi-budi-budi'], ['budi', 'passwordpassword']])
      expect((await env.sys.setup.setAccount(u, p)).ok, `${u}/${p}`).toBe(false)
    expect((await env.sys.setup.setAccount('  BUDI.Santoso  ', 'kopi susu gula aren tiga sendok')).ok).toBe(true)
  })
  it('does not accept a wrong authenticator code, and shows recovery codes only after a right one', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE); await env.sys.setup.sendOwnerOtp(ctx())
    env.sys.setup.verifyOwnerOtp(env.worker.last()!.code!, ctx())
    const acct = await env.sys.setup.setAccount('budi', 'kopi susu gula aren tiga sendok')
    if (!acct.ok) throw new Error()
    expect(acct.uri).toMatch(/^otpauth:\/\/totp\/AutoBot:budi\?secret=[A-Z2-7]{32}&/)
    expect(env.sys.setup.verifyTotp('000000', ctx())).toMatchObject({ ok: false, code: 'INVALID_CODE' })
    expect(env.sys.setup.finish(true, ctx())).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(env.sys.setup.verifyTotp(env.codeFor(acct.secret), ctx()).ok).toBe(true)
  })
  it('will not finish unless the person says the recovery codes are saved', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE); await env.sys.setup.sendOwnerOtp(ctx())
    env.sys.setup.verifyOwnerOtp(env.worker.last()!.code!, ctx())
    const acct = await env.sys.setup.setAccount('budi', 'kopi susu gula aren tiga sendok'); if (!acct.ok) throw new Error()
    env.sys.setup.verifyTotp(env.codeFor(acct.secret), ctx())
    expect(env.sys.setup.finish(false, ctx())).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(env.sys.setup.finish('ya' as never, ctx())).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(env.sys.setup.isComplete()).toBe(false)
  })
})

describe('finishing is atomic and final', () => {
  it('a second account cannot be created: the database itself refuses', async () => {
    const env = makeEnv()
    await createOwner(env)
    expect(() => env.db.prepare("INSERT INTO users(id, username, password_hash, owner_phone, created_at, password_changed_at) VALUES (2, 'x', 'x', '6281', 1, 1)").run()).toThrow()
    expect(() => env.db.prepare("INSERT INTO users(id, username, password_hash, owner_phone, created_at, password_changed_at) VALUES (1, 'x', 'x', '6281', 1, 1)").run()).toThrow()
  })
  it('two wizards finishing at once: one account, the other gets a conflict', async () => {
    const env = makeEnv(); env.sys.setup.ensureToken()
    await env.sys.setup.setOwnerPhone(OWNER_PHONE); await env.sys.setup.sendOwnerOtp(ctx())
    env.sys.setup.verifyOwnerOtp(env.worker.last()!.code!, ctx())
    const acct = await env.sys.setup.setAccount('budi', 'kopi susu gula aren tiga sendok'); if (!acct.ok) throw new Error()
    env.sys.setup.verifyTotp(env.codeFor(acct.secret), ctx())
    // someone else's account lands between the checks and the insert
    env.db.prepare("INSERT INTO users(id, username, password_hash, owner_phone, created_at, password_changed_at) VALUES (1, 'lain', 'x', '6281', 1, 1)").run()
    expect(env.sys.setup.finish(true, ctx())).toMatchObject({ ok: false, code: 'CONFLICT' })
    expect(env.db.prepare("SELECT username FROM users").all()).toEqual([{ username: 'lain' }])
  })
  it('after setup the wizard is closed for good: the token, the endpoints, and a restart', async () => {
    const env = makeEnv()
    const o = await createOwner(env)
    expect(env.sys.setup.submitToken(o.setupToken, ctx('5.5.5.5'))).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(env.sys.setup.ensureToken()).toBeNull() // a restart prints no new token
    expect(env.db.prepare('SELECT COUNT(*) AS c FROM setup_state').get()).toEqual({ c: 0 })
  })
})

describe('what is stored', () => {
  it('no password, authenticator secret, recovery code, verification code or setup token in plain text anywhere', async () => {
    const env = makeEnv()
    const o = await createOwner(env, { password: 'sandi-rahasia-yang-sangat-panjang' })
    const text = dbText(env)
    const otp = env.sys.audit.recent(500).map((r) => r.detail ?? '').join('')
    for (const secret of [o.password, o.secret, o.setupToken, ...o.recoveryCodes, ...o.recoveryCodes.map((c) => c.replace('-', ''))])
      expect(text, secret).not.toContain(secret)
    expect(otp).not.toMatch(/\b\d{6}\b/)
    expect(env.sys.auth.user()!.password_hash).toMatch(/^\$argon2id\$/)
  })
})
