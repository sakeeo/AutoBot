import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Keys, safeEqual, sha256 } from '../src/server/auth/crypto'
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from '../src/server/auth/password'
import { RateWindow, Throttle } from '../src/server/auth/throttle'
import { OTP, OtpService } from '../src/server/auth/otp'
import { RECOVERY_COUNT, RecoveryCodes } from '../src/server/auth/recovery'
import { Sessions } from '../src/server/auth/sessions'
import { Audit } from '../src/server/auth/audit'
import { makeBase } from './helpers'

describe('Keys', () => {
  it('derives different keys per purpose and the same key every time', () => {
    const k = new Keys(randomBytes(32))
    expect(k.for('otp').equals(k.for('otp'))).toBe(true)
    expect(k.for('otp').equals(k.for('recovery'))).toBe(false)
    expect(k.hmac('otp', 'a')).not.toBe(k.hmac('recovery', 'a'))
  })
  it('refuses a master key that is not 32 bytes', () => {
    expect(() => new Keys(randomBytes(16))).toThrow()
  })
  it('seals and opens, authenticates the label, and refuses another key or a tampered value', () => {
    const k = new Keys(randomBytes(32))
    const sealed = k.seal('totp', 'user:1', 'RAHASIA')
    expect(sealed).not.toContain('RAHASIA')
    expect(k.open('totp', 'user:1', sealed)).toBe('RAHASIA')
    expect(k.open('totp', 'user:2', sealed)).toBeNull() // moved to another place
    expect(k.open('otp', 'user:1', sealed)).toBeNull() // wrong purpose
    expect(new Keys(randomBytes(32)).open('totp', 'user:1', sealed)).toBeNull()
    const raw = Buffer.from(sealed, 'base64'); raw[raw.length - 1] ^= 1
    expect(k.open('totp', 'user:1', raw.toString('base64'))).toBeNull()
  })
  it('compares strings in constant time without being fooled by length or prefix', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
    expect(sha256('a')).toHaveLength(64)
  })
})

describe('passwords', () => {
  it('hashes with argon2id at the OWASP minimum and verifies, normalising Unicode', async () => {
    const h = await hashPassword('kalimat sandi yang panjang')
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/)
    expect(await verifyPassword(h, 'kalimat sandi yang panjang')).toBe(true)
    expect(await verifyPassword(h, 'kalimat sandi yang panjang!')).toBe(false)
    expect(await verifyPassword('bukan hash', 'x')).toBe(false)
    const accent = await hashPassword('café café café')
    expect(await verifyPassword(accent, 'café café café')).toBe(true)
  })
  it('salts: the same password never hashes the same way twice', async () => {
    expect(await hashPassword('kalimat sandi yang panjang')).not.toBe(await hashPassword('kalimat sandi yang panjang'))
  })
  it('burns about as much time for an unknown user as for a wrong password', async () => {
    const h = await hashPassword('kalimat sandi yang panjang')
    const time = async (f: () => Promise<unknown>) => { const t = performance.now(); await f(); return performance.now() - t }
    await burnPasswordCheck('x') // warm the dummy hash
    const wrong = await time(() => verifyPassword(h, 'salah-salah-salah'))
    const burn = await time(() => burnPasswordCheck('salah-salah-salah'))
    expect(burn).toBeGreaterThan(wrong / 4)
  })
  it.each([
    ['pendek123', /minimal 12/], ['a'.repeat(201), /maksimal 200/], ['budi-budi-2025', /username/], ['passwordpassword', /umum/],
    ['aaaaaaaaaaaaaa', /diulang/], ['abcdefghijklmnop', /urutan/], ['12345678901234', /umum|urutan/], ['abababababab', /sederhana/]
  ])('rejects %s', (pw, why) => expect(passwordProblem(pw as string, 'budi')).toMatch(why as RegExp))
  it('accepts a long passphrase with no composition rules', () => {
    expect(passwordProblem('kopi susu gula aren tiga sendok', 'budi')).toBeNull()
    expect(passwordProblem('tanpa angka atau simbol sama sekali', 'budi')).toBeNull()
  })
})

describe('Throttle', () => {
  it('lets five failures through, then waits a minute, then doubles up to an hour, and forgives after a success', () => {
    const { db, clock } = makeBase()
    const t = new Throttle(db, clock)
    for (let i = 0; i < 4; i++) { t.fail('k'); expect(t.check('k').allowed).toBe(true) }
    t.fail('k')
    expect(t.check('k')).toEqual({ allowed: false, retryAfterSec: 60 })
    clock.advance(61_000)
    expect(t.check('k').allowed).toBe(true)
    t.fail('k')
    expect(t.check('k').retryAfterSec).toBe(120)
    clock.advance(121_000); t.fail('k')
    expect(t.check('k').retryAfterSec).toBe(240)
    for (let i = 0; i < 20; i++) { clock.advance(3_700_000); t.fail('k') }
    expect(t.check('k').retryAfterSec).toBeLessThanOrEqual(3600)
    t.reset('k')
    expect(t.check('k').allowed).toBe(true)
  })
  it('keeps keys apart, survives a restart, and forgets failures after a day', () => {
    const { db, clock } = makeBase()
    const a = new Throttle(db, clock)
    for (let i = 0; i < 5; i++) a.fail('ip:1')
    expect(new Throttle(db, clock).check('ip:1').allowed).toBe(false) // a "restarted" instance on the same database
    expect(a.check('ip:2').allowed).toBe(true)
    clock.advance(25 * 3_600_000)
    a.fail('ip:1')
    expect(a.check('ip:1').allowed).toBe(true) // old failures forgotten: this one counts as the first
  })
})

describe('RateWindow', () => {
  it('allows `max` uses per window, then refuses until the window has passed', () => {
    const { db, clock } = makeBase()
    const w = new RateWindow(db, clock)
    for (let i = 0; i < 5; i++) expect(w.consume('x', 5, 60_000)).toBe(true)
    expect(w.consume('x', 5, 60_000)).toBe(false)
    expect(w.consume('y', 5, 60_000)).toBe(true)
    clock.advance(60_001)
    expect(w.consume('x', 5, 60_000)).toBe(true)
  })
})

describe('OtpService', () => {
  const PHONE = '6281234567890'
  const make = () => { const b = makeBase(); return { ...b, otp: new OtpService(b.db, b.keys, b.clock) } }
  const issue = (o: OtpService, p: 'setup' | 'reset' | 'change_phone' = 'setup', phone = PHONE) => { const r = o.issue(p, phone); if (!r.ok) throw new Error(r.reason); return r.code }

  it('issues a six-digit code that verifies once', () => {
    const { otp } = make()
    const code = issue(otp)
    expect(code).toMatch(/^\d{6}$/)
    expect(otp.verify('setup', PHONE, code)).toEqual({ ok: true })
    expect(otp.verify('setup', PHONE, code)).toEqual({ ok: false, reason: 'INVALID' }) // single use
  })
  it('stores only an HMAC: the code is nowhere in the database', () => {
    const { otp, db } = make()
    const code = issue(otp)
    expect(JSON.stringify(db.prepare('SELECT * FROM otp_challenges').all())).not.toContain(code)
  })
  it('does not accept a code for another purpose or another number', () => {
    const { otp } = make()
    const code = issue(otp, 'reset')
    expect(otp.verify('setup', PHONE, code).ok).toBe(false)
    expect(otp.verify('reset', '6289999999999', code).ok).toBe(false)
    expect(otp.verify('reset', PHONE, code).ok).toBe(true)
  })
  it('expires after five minutes', () => {
    const { otp, clock } = make()
    const code = issue(otp)
    clock.advance(OTP.ttlMs + 1)
    expect(otp.verify('setup', PHONE, code).ok).toBe(false)
  })
  it('kills the code after five wrong guesses, even if the right one comes next', () => {
    const { otp } = make()
    const code = issue(otp)
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect(otp.verify('setup', PHONE, wrong).ok).toBe(false)
    expect(otp.verify('setup', PHONE, code).ok).toBe(false)
  })
  it('a new code retires the old one', () => {
    const { otp, clock } = make()
    const first = issue(otp)
    clock.advance(OTP.cooldownMs + 1)
    const second = issue(otp)
    if (first !== second) expect(otp.verify('setup', PHONE, first).ok).toBe(false)
    expect(otp.verify('setup', PHONE, second).ok).toBe(true)
  })
  it('enforces a 60-second pause between sends', () => {
    const { otp, clock } = make()
    issue(otp)
    const again = otp.issue('setup', PHONE)
    expect(again).toMatchObject({ ok: false, reason: 'COOLDOWN' })
    clock.advance(59_000)
    expect(otp.issue('setup', PHONE)).toMatchObject({ ok: false, reason: 'COOLDOWN' })
    clock.advance(1_001)
    expect(otp.issue('setup', PHONE).ok).toBe(true)
  })
  it('allows three sends per 15 minutes per number; the fourth is refused and no code exists for it', () => {
    const { otp, clock, db } = make()
    for (let i = 0; i < 3; i++) { issue(otp); clock.advance(61_000) }
    const fourth = otp.issue('setup', PHONE)
    expect(fourth).toMatchObject({ ok: false, reason: 'RATE_LIMITED' })
    expect((db.prepare('SELECT COUNT(*) AS c FROM otp_challenges').get() as { c: number }).c).toBe(3)
    clock.advance(15 * 60_000)
    expect(otp.issue('setup', PHONE).ok).toBe(true)
  })
  it('caps every number together at ten an hour', () => {
    const { otp, clock } = make()
    for (let i = 0; i < OTP.globalHour; i++) { issue(otp, 'setup', `62811000000${i}`); clock.advance(1000) }
    expect(otp.issue('setup', '6285550000000')).toMatchObject({ ok: false, reason: 'RATE_LIMITED' })
  })
  it('suspends codes for an hour after 15 wrong guesses in a day, and recovers', () => {
    const { otp, clock } = make()
    for (let round = 0; round < 3; round++) {
      issue(otp); clock.advance(61_000)
      for (let i = 0; i < 5; i++) otp.verify('setup', PHONE, '------')
      clock.advance(15 * 60_000)
    }
    expect(otp.suspendedForSec()).toBeGreaterThan(0)
    expect(otp.issue('setup', PHONE)).toMatchObject({ ok: false, reason: 'SUSPENDED' })
    expect(otp.verify('setup', PHONE, '123456')).toEqual({ ok: false, reason: 'SUSPENDED' })
    clock.advance(61 * 60_000)
    expect(otp.suspendedForSec()).toBe(0)
  })
  it('treats a malformed code as wrong without throwing', () => {
    const { otp } = make()
    issue(otp)
    for (const bad of ['', 'abc', '12345', '1234567', '12 456']) expect(otp.verify('setup', PHONE, bad).ok).toBe(false)
  })
})

describe('RecoveryCodes', () => {
  const make = () => { const b = makeBase(); return { ...b, rc: new RecoveryCodes(b.db, b.keys, b.clock) } }
  it('makes ten distinct readable codes and keeps only their HMACs', () => {
    const { rc, db } = make()
    const g = rc.generate()
    expect(g.shown).toHaveLength(RECOVERY_COUNT)
    expect(new Set(g.shown).size).toBe(RECOVERY_COUNT)
    for (const c of g.shown) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/)
    rc.replaceAll(g.hmacs)
    expect(JSON.stringify(db.prepare('SELECT * FROM recovery_codes').all())).not.toContain(g.shown[0].replace('-', ''))
    expect(rc.remaining()).toBe(RECOVERY_COUNT)
  })
  it('accepts each code once, in any case and with or without the dash', () => {
    const { rc } = make()
    const g = rc.generate(); rc.replaceAll(g.hmacs)
    expect(rc.use(g.shown[0].toLowerCase())).toBe(true)
    expect(rc.use(g.shown[0])).toBe(false)
    expect(rc.use(g.shown[1].replace('-', ' '))).toBe(true)
    expect(rc.remaining()).toBe(RECOVERY_COUNT - 2)
  })
  it('refuses a wrong or short code, and old codes once replaced', () => {
    const { rc } = make()
    const a = rc.generate(); rc.replaceAll(a.hmacs)
    expect(rc.use('AAAAA-AAAAA')).toBe(false)
    expect(rc.use('abc')).toBe(false)
    const b = rc.generate(); rc.replaceAll(b.hmacs)
    expect(rc.use(a.shown[2])).toBe(false)
    expect(rc.use(b.shown[2])).toBe(true)
  })
})

describe('Sessions', () => {
  const make = () => { const b = makeBase(); return { ...b, s: new Sessions(b.db, b.keys, b.clock) } }
  it('stores only a hash of the token and finds the session by token and kind', () => {
    const { s, db } = make()
    const { token } = s.create('owner', { userAgent: 'Firefox' })
    expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain(token)
    expect(s.get('owner', token)?.kind).toBe('owner')
    expect(s.get('pending', token)).toBeNull() // a token is only good for the kind it was made for
    expect(s.get('owner', 'x'.repeat(43))).toBeNull()
    expect(s.get('owner', undefined)).toBeNull()
    expect(s.get('owner', 'y'.repeat(500))).toBeNull()
  })
  it('ends an owner session after 30 idle minutes, but keeps one that stays busy', () => {
    const { s, clock } = make()
    const { token } = s.create('owner')
    for (let i = 0; i < 5; i++) { clock.advance(20 * 60_000); expect(s.get('owner', token)).not.toBeNull() }
    clock.advance(31 * 60_000)
    expect(s.get('owner', token)).toBeNull()
  })
  it('ends an owner session after 12 hours however busy it is', () => {
    const { s, clock } = make()
    const { token } = s.create('owner')
    for (let i = 0; i < 23; i++) { clock.advance(29 * 60_000); s.get('owner', token) }
    expect(s.get('owner', token)).not.toBeNull() // 11h07m
    for (let i = 0; i < 3; i++) { clock.advance(29 * 60_000); s.get('owner', token) }
    expect(s.get('owner', token)).toBeNull()
  })
  it('gives short-lived kinds their own limits', () => {
    const { s, clock } = make()
    const p = s.create('pending'); const r = s.create('reset'); const u = s.create('setup')
    clock.advance(6 * 60_000)
    expect(s.get('pending', p.token)).toBeNull()
    expect(s.get('reset', r.token)).not.toBeNull()
    clock.advance(5 * 60_000)
    expect(s.get('reset', r.token)).toBeNull()
    expect(s.get('setup', u.token)).not.toBeNull() // the wizard session is idle-limited to 30 minutes, not 10
    clock.advance(31 * 60_000)
    expect(s.get('setup', u.token)).toBeNull()
  })
  it('revokes one session, all sessions of a kind except one, or everything', () => {
    const { s } = make()
    const a = s.create('owner'); const b = s.create('owner'); const c = s.create('owner')
    s.revoke(a.token)
    expect(s.get('owner', a.token)).toBeNull()
    s.revokeKind('owner', s.get('owner', b.token)!.idHash)
    expect(s.get('owner', b.token)).not.toBeNull()
    expect(s.get('owner', c.token)).toBeNull()
    s.revokeAll()
    expect(s.get('owner', b.token)).toBeNull()
  })
  it('lists active devices by a short id and revokes by it, but never the current one', () => {
    const { s } = make()
    const a = s.create('owner', { userAgent: 'A' }); const b = s.create('owner', { userAgent: 'B' })
    const list = s.listOwner()
    expect(list).toHaveLength(2)
    const idA = list.find((x) => x.userAgent === 'A')!
    expect(s.revokeByShortId(idA.id, s.get('owner', b.token)!.idHash)).toBe(true)
    expect(s.get('owner', a.token)).toBeNull()
    expect(s.revokeByShortId(list.find((x) => x.userAgent === 'B')!.id, s.get('owner', b.token)!.idHash)).toBe(false)
    expect(s.revokeByShortId('not-hex', undefined)).toBe(false)
  })
  it('seals the data of a step in progress and gives it back', () => {
    const { s, db } = make()
    const { token } = s.create('pending', { data: { enrollSecret: 'JBSWY3DP' } })
    expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain('JBSWY3DP')
    expect(s.get('pending', token)?.data).toEqual({ enrollSecret: 'JBSWY3DP' })
  })
  it('tracks a recent password check and the restricted flag', () => {
    const { s, clock } = make()
    const { token } = s.create('owner', { restricted: true })
    const got = s.get('owner', token)!
    expect(got.restricted).toBe(true)
    expect(got.reauthAt).toBeNull()
    s.markReauth(got.idHash); s.setRestricted(got.idHash, false)
    expect(s.get('owner', token)).toMatchObject({ restricted: false, reauthAt: clock.now() })
  })
})

describe('Audit', () => {
  it('records actions without secrets and returns the newest first', () => {
    const { db, clock } = makeBase()
    const a = new Audit(db, clock)
    a.log('login_ok', { actor: 'budi' })
    clock.advance(1000)
    a.log('password_changed', { actor: 'budi', via: 'server', detail: { sessionsRevoked: 3 } })
    const rows = a.recent()
    expect(rows.map((r) => r.action)).toEqual(['password_changed', 'login_ok'])
    expect(rows[0]).toMatchObject({ via: 'server', detail: '{"sessionsRevoked":3}' })
  })
})

describe('Sessions: activity versus background polling', () => {
  it('a call that does not touch the session does not keep it alive, one that does, does', () => {
    const b = makeBase(); const s = new Sessions(b.db, b.keys, b.clock)
    const { token } = s.create('owner')
    for (let i = 0; i < 2; i++) { b.clock.advance(10 * 60_000); expect(s.get('owner', token, false)).not.toBeNull() } // polling only
    b.clock.advance(10 * 60_000)
    expect(s.get('owner', token, false)).toBeNull() // 30 minutes without activity: gone, however much it was polled
    const { token: t2 } = s.create('owner')
    for (let i = 0; i < 4; i++) { b.clock.advance(10 * 60_000); expect(s.get('owner', t2, true)).not.toBeNull() }
  })
})
