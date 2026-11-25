import { describe, it, expect } from 'vitest'
import * as setup from '../src/server/handlers/setup'
import * as auth from '../src/server/handlers/auth'
import * as pub from '../src/server/handlers/public'
import { rpc } from '../src/server/handlers/rpc'
import { events } from '../src/server/handlers/events'
import * as kb from '../src/server/handlers/knowledge'
import { APP, call, json, Jar, makeWebEnv, OWNER_PHONE, type WebEnv } from './helpers'

const rpcRoute = rpc((req) => decodeURIComponent(new URL(req.url).pathname.split('/').pop() ?? ''))
const PASSWORD = 'kopi susu gula aren tiga sendok'

/** Runs the whole wizard through the HTTP handlers, as the browser would. */
async function wizard(env: WebEnv, jar = new Jar()) {
  const token = env.sys.setup.ensureToken()!
  expect((await call(setup.token, { path: '/api/setup/token', body: { token }, jar })).status).toBe(200)
  expect((await call(setup.ownerPhone, { path: '/api/setup/owner-phone', body: { phone: OWNER_PHONE }, jar })).status).toBe(200)
  expect((await call(setup.ownerOtpSend, { path: '/api/setup/owner-otp/send', body: {}, jar })).status).toBe(200)
  expect((await call(setup.ownerOtpVerify, { path: '/api/setup/owner-otp/verify', body: { code: env.worker.last('otp_setup')!.code }, jar })).status).toBe(200)
  const acct = await json(await call(setup.account, { path: '/api/setup/account', body: { username: 'budi', password: PASSWORD }, jar }))
  const totp = await json(await call(setup.totp, { path: '/api/setup/totp', body: { code: env.codeFor(acct.secret) }, jar }))
  const setupCookie = jar.get('setup') as string
  const fin = await call(setup.finish, { path: '/api/setup/finish', body: { savedRecoveryCodes: true }, jar })
  expect(fin.status).toBe(200)
  return { jar, token, setupCookie, secret: acct.secret as string, recoveryCodes: totp.recoveryCodes as string[] }
}

async function loginHttp(env: WebEnv, o: { secret: string }, jar = new Jar(), ip = '1.1.1.1') {
  const h = { 'x-forwarded-for': ip }
  const a = await call(auth.login, { path: '/api/auth/login', body: { username: 'budi', password: PASSWORD }, jar, headers: h })
  expect(a.status).toBe(200)
  env.clock.advance(31_000)
  const b = await call(auth.totpVerify, { path: '/api/auth/totp', body: { code: env.codeFor(o.secret) }, jar, headers: h })
  expect(b.status).toBe(200)
  return jar
}

describe('the wizard over HTTP', () => {
  it('walks every step, signs the owner in at the end, and closes itself', async () => {
    const env = makeWebEnv()
    const { jar, token } = await wizard(env)
    expect(jar.names()).toEqual(['sid']) // the wizard cookie was cleared, the session cookie set
    expect((await call(auth.session, { method: 'GET', path: '/api/auth/session', jar })).status).toBe(200)
    // closed for good: the token, the state, and every step answer 404
    for (const [h, p, m] of [[setup.token, '/api/setup/token', 'POST'], [setup.state, '/api/setup/state', 'GET'], [setup.ownerPhone, '/api/setup/owner-phone', 'POST']] as const)
      expect((await call(h as never, { method: m, path: p, body: m === 'POST' ? (p.endsWith('token') ? { token } : { phone: OWNER_PHONE }) : undefined, jar })).status, p).toBe(404)
  })
  it('refuses every step without a wizard session, and a wrong token gives none', async () => {
    const env = makeWebEnv(); env.sys.setup.ensureToken()
    for (const [h, p, body] of [
      [setup.ownerPhone, '/api/setup/owner-phone', { phone: OWNER_PHONE }], [setup.ownerOtpSend, '/api/setup/owner-otp/send', {}],
      [setup.ownerOtpVerify, '/api/setup/owner-otp/verify', { code: '123456' }], [setup.account, '/api/setup/account', { username: 'budi', password: PASSWORD }],
      [setup.totp, '/api/setup/totp', { code: '123456' }], [setup.finish, '/api/setup/finish', { savedRecoveryCodes: true }]] as const)
      expect((await call(h as never, { path: p, body })).status, p).toBe(401)
    expect((await call(setup.state, { method: 'GET', path: '/api/setup/state' })).status).toBe(401)
    const jar = new Jar()
    expect((await call(setup.token, { path: '/api/setup/token', body: { token: 'salah' }, jar })).status).toBe(401)
    expect(jar.names()).toEqual([])
  })
  it('tells the wizard where it stands, with the bot number masked', async () => {
    const env = makeWebEnv(); const token = env.sys.setup.ensureToken()!
    const jar = new Jar(); await call(setup.token, { path: '/api/setup/token', body: { token }, jar })
    const s = await json(await call(setup.state, { method: 'GET', path: '/api/setup/state', jar }))
    expect(s).toMatchObject({ ok: true, progress: { phoneVerified: false, hasAccount: false }, wa: { state: 'connected' }, botNumber: '62••••345' })
    expect(JSON.stringify(s)).not.toContain(env.worker.self!)
  })
  it('passes on the reason when the code cannot be delivered', async () => {
    const env = makeWebEnv(); const token = env.sys.setup.ensureToken()!
    const jar = new Jar(); await call(setup.token, { path: '/api/setup/token', body: { token }, jar })
    await call(setup.ownerPhone, { path: '/api/setup/owner-phone', body: { phone: OWNER_PHONE }, jar })
    env.worker.failWith = 'NOT_ON_WHATSAPP'
    const r = await call(setup.ownerOtpSend, { path: '/api/setup/owner-otp/send', body: {}, jar })
    expect(r.status).toBe(503)
    expect(await json(r)).toMatchObject({ ok: false, code: 'WA_UNAVAILABLE', message: 'Nomor itu tidak terdaftar di WhatsApp.' })
  })
})

describe('guards that apply to every route', () => {
  it('refuses a state-changing request that does not come from this site', async () => {
    const env = makeWebEnv()
    for (const [label, o] of [
      ['no origin and no fetch metadata', { origin: null }], ['another origin', { origin: 'https://jahat.example' }],
      ['cross-site fetch metadata', { origin: null, headers: { 'sec-fetch-site': 'cross-site' } }], ['same-site (a sibling domain)', { origin: null, headers: { 'sec-fetch-site': 'same-site' } }]] as const) {
      const r = await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'b' }, ...o })
      expect(r.status, label).toBe(403)
    }
    void env
  })
  it('accepts the browser\'s own signals: the right Origin, or Sec-Fetch-Site same-origin', async () => {
    makeWebEnv()
    expect((await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'b' } })).status).toBe(401)
    expect((await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'b' }, origin: null, headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(401)
  })
  it('rejects bodies that are not JSON, have extra fields, or are too large', async () => {
    makeWebEnv()
    expect((await call(auth.login, { path: '/api/auth/login', raw: 'username=a', type: 'text/plain' })).status).toBe(400)
    expect((await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'b', admin: true } })).status).toBe(400)
    expect((await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'x'.repeat(30_000) } })).status).toBe(400)
    expect((await call(auth.login, { path: '/api/auth/login', raw: '{not json', type: 'application/json' })).status).toBe(400)
  })
  it('never caches an answer and always says what type it is', async () => {
    makeWebEnv()
    const r = await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'b' } })
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-type')).toContain('application/json')
  })
  it('answers an unexpected failure with a generic 500 and nothing about the cause', async () => {
    const env = makeWebEnv()
    env.sys.auth.login = async () => { throw new Error('SELECT * FROM users /etc/secret') }
    const r = await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'b' } })
    expect(r.status).toBe(500)
    expect(JSON.stringify(await json(r))).not.toMatch(/SELECT|etc/)
  })
})

describe('cookies', () => {
  it('on localhost: plain names, HttpOnly, SameSite, no Secure; the pending cookie is Strict and lives five minutes', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    const jar = new Jar()
    const res = await call(auth.login, { path: '/api/auth/login', body: { username: 'budi', password: PASSWORD }, jar })
    const c = res.headers.getSetCookie()[0]
    expect(c).toMatch(/^pend=/)
    expect(c).toContain('HttpOnly'); expect(c).toContain('SameSite=Strict'); expect(c).toContain('Max-Age=300'); expect(c).toContain('Path=/')
    expect(c).not.toContain('Secure')
    env.clock.advance(31_000)
    const ok = await call(auth.totpVerify, { path: '/api/auth/totp', body: { code: env.codeFor(o.secret) }, jar })
    const sid = ok.headers.getSetCookie().find((x) => x.startsWith('sid='))!
    expect(sid).toContain('SameSite=Lax'); expect(sid).toContain('HttpOnly'); expect(sid).not.toContain('Max-Age') // a session cookie
  })
  it('over https: __Host- names with Secure, Path=/ and no Domain', async () => {
    const env = makeWebEnv({ appUrl: 'https://panel.contoh.id' })
    const token = env.sys.setup.ensureToken()!
    const res = await call(setup.token, { path: '/api/setup/token', body: { token }, origin: 'https://panel.contoh.id' })
    const c = res.headers.getSetCookie()[0]
    expect(c).toMatch(/^__Host-setup=/)
    expect(c).toContain('Secure'); expect(c).toContain('Path=/'); expect(c).toContain('HttpOnly')
    expect(c).not.toMatch(/Domain=/i)
  })
  it('refuses the old origin once the panel is on its https address', async () => {
    makeWebEnv({ appUrl: 'https://panel.contoh.id' })
    expect((await call(auth.login, { path: '/api/auth/login', body: { username: 'a', password: 'b' }, origin: APP })).status).toBe(403)
  })
})

describe('signing in over HTTP', () => {
  it('password then code, and a session that works', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    const jar = await loginHttp(env, o, new Jar())
    const me = await json(await call(auth.session, { method: 'GET', path: '/api/auth/session', jar }))
    expect(me).toMatchObject({ ok: true, username: 'budi', restricted: false, reauthRecent: false })
    expect(JSON.stringify(me)).not.toMatch(/argon2|hmac|secret/i)
  })
  it('the pending cookie alone is not a session', async () => {
    const env = makeWebEnv(); await wizard(env)
    const jar = new Jar()
    await call(auth.login, { path: '/api/auth/login', body: { username: 'budi', password: PASSWORD }, jar })
    expect((await call(auth.session, { method: 'GET', path: '/api/auth/session', jar })).status).toBe(401)
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] }, jar })).status).toBe(401)
  })
  it('answers a wrong login the same way for a wrong password and an unknown user, and asks to wait when throttled', async () => {
    const env = makeWebEnv(); await wizard(env)
    const a = await call(auth.login, { path: '/api/auth/login', body: { username: 'budi', password: 'salah-salah-salah-salah' } })
    const b = await call(auth.login, { path: '/api/auth/login', body: { username: 'bukan-budi', password: 'salah-salah-salah-salah' } })
    expect(a.status).toBe(401); expect(await json(a)).toEqual(await json(b))
    for (let i = 0; i < 5; i++) await call(auth.login, { path: '/api/auth/login', body: { username: 'budi', password: 'salah-salah-salah-salah' } })
    const t = await call(auth.login, { path: '/api/auth/login', body: { username: 'budi', password: PASSWORD } })
    expect(t.status).toBe(429)
    expect(t.headers.get('retry-after')).toBe('60')
  })
  it('logout ends the session and clears the cookies', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    const jar = await loginHttp(env, o, new Jar())
    const res = await call(auth.logout, { path: '/api/auth/logout', body: {}, jar })
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sid=;') && c.includes('Max-Age=0'))).toBe(true)
    expect((await call(auth.session, { method: 'GET', path: '/api/auth/session', jar: Object.assign(new Jar(), {}) })).status).toBe(401)
  })
  it('a recovery-code session may only set up a new authenticator or sign out: nothing else', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    const jar = new Jar()
    await call(auth.login, { path: '/api/auth/login', body: { username: 'budi', password: PASSWORD }, jar })
    const r = await call(auth.recovery, { path: '/api/auth/recovery', body: { code: o.recoveryCodes[0] }, jar })
    expect(await json(r)).toMatchObject({ ok: true, restricted: true })
    expect(await json(await call(auth.session, { method: 'GET', path: '/api/auth/session', jar }))).toMatchObject({ restricted: true })
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] }, jar })).status).toBe(403)
    expect((await call(auth.devices, { method: 'GET', path: '/api/auth/devices', jar })).status).toBe(403)
    expect((await call(events, { method: 'GET', path: '/api/events', jar })).status).toBe(403)
    const start = await json(await call(auth.totpEnrollStart, { path: '/api/auth/totp/enroll', body: {}, jar }))
    expect(start.ok).toBe(true)
    env.clock.advance(31_000)
    expect((await call(auth.totpEnrollConfirm, { path: '/api/auth/totp/enroll/confirm', body: { code: env.codeFor(start.secret) }, jar })).status).toBe(200)
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] }, jar })).status).toBe(200)
  })
  it('forgot password: same answer either way, a code sets a new password, and nobody is signed in after', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    env.clock.advance(61_000)
    const a = await call(auth.forgot, { path: '/api/auth/forgot', body: { username: 'budi' }, headers: { 'x-forwarded-for': '1.1.1.1' } })
    const b = await call(auth.forgot, { path: '/api/auth/forgot', body: { username: 'tidak-ada' }, headers: { 'x-forwarded-for': '2.2.2.2' } })
    expect(await json(a)).toEqual(await json(b))
    await new Promise((r) => setTimeout(r, 0))
    const jar = new Jar()
    const v = await call(auth.forgotVerify, { path: '/api/auth/forgot/verify', body: { code: env.worker.last('otp_reset')!.code }, jar })
    expect(v.status).toBe(200)
    expect(jar.names()).toEqual(['reset'])
    const r = await call(auth.forgotReset, { path: '/api/auth/forgot/reset', body: { newPassword: 'sandi baru yang cukup panjang ya' }, jar })
    expect(r.status).toBe(200)
    expect(jar.names()).toEqual([]) // no session cookie was issued
    void o
  })
})

describe('the door from the browser to the worker (/api/rpc)', () => {
  const owner = async () => { const env = makeWebEnv(); const o = await wizard(env); return { env, o, jar: await loginHttp(env, o, new Jar()) } }
  it('passes a call to the worker and returns its answer', async () => {
    const { env, jar } = await owner()
    env.worker.rpcAnswer = () => ({ ok: true, data: { mode: 'extractive' } })
    const r = await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] }, jar })
    expect(await json(r)).toEqual({ ok: true, data: { mode: 'extractive' } })
    expect(env.worker.rpcCalls.at(-1)).toEqual({ method: 'getSettings', args: [] })
  })
  it('only forwards methods that are in the contract, never an event, a prototype name or a made-up name', async () => {
    const { env, jar } = await owner()
    const before = env.worker.rpcCalls.length
    for (const m of ['nope', 'evtStatus', 'evtMessage', '__proto__', 'constructor', 'bcOverview', 'authLogin', 'pickFolder', 'a'.repeat(70), 'x%2Fy'])
      expect((await call(rpcRoute, { path: `/api/rpc/${m}`, body: { args: [] }, jar })).status, m).toBe(404)
    expect(env.worker.rpcCalls.length).toBe(before)
  })
  it('refuses a call with no session, and limits the arguments', async () => {
    const { jar } = await owner()
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] } })).status).toBe(401)
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: Array(9).fill(1) }, jar })).status).toBe(400)
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [], extra: 1 }, jar })).status).toBe(400)
  })
  it('asks for the password again before the risky ones, then lets them through for ten minutes', async () => {
    const { env, jar } = await owner()
    for (const m of ['saveApiKey', 'deleteApiKey', 'connect', 'logout', 'eraseCustomer', 'setBotEnabled']) {
      const r = await call(rpcRoute, { path: `/api/rpc/${m}`, body: { args: [true] }, jar })
      expect(r.status, m).toBe(403)
      expect(await json(r)).toMatchObject({ code: 'STEP_UP_REQUIRED' })
    }
    expect(env.worker.rpcCalls.some((c) => c.method === 'setBotEnabled')).toBe(false)
    expect((await call(auth.reauth, { path: '/api/auth/reauth', body: { password: 'salah-salah-salah' }, jar })).status).toBe(401)
    expect((await call(auth.reauth, { path: '/api/auth/reauth', body: { password: PASSWORD }, jar })).status).toBe(200)
    env.worker.rpcAnswer = () => ({ ok: true, data: true })
    expect((await call(rpcRoute, { path: '/api/rpc/setBotEnabled', body: { args: [true] }, jar })).status).toBe(200)
    env.clock.advance(11 * 60_000)
    expect((await call(rpcRoute, { path: '/api/rpc/setBotEnabled', body: { args: [true] }, jar })).status).toBe(403)
  })
  it('shows the worker\'s own message for a rejected call, with the right status, and hides a broken worker', async () => {
    const { env, jar } = await owner()
    env.worker.rpcAnswer = () => ({ ok: false, status: 400, code: 'REJECTED', message: 'API key belum diatur.' })
    const a = await call(rpcRoute, { path: '/api/rpc/updateSettings', body: { args: [{ mode: 'ai' }] }, jar })
    expect(a.status).toBe(400); expect(await json(a)).toMatchObject({ code: 'REJECTED', message: 'API key belum diatur.' })
    env.worker.rpcAnswer = () => ({ ok: false, status: 502, code: 'UPSTREAM', message: 'Worker tidak bisa dihubungi.' })
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] }, jar })).status).toBe(502)
    env.worker.rpcAnswer = () => ({ ok: false, status: 200, code: 'X', message: 'aneh' }) // a failure that claims to be a success
    expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] }, jar })).status).toBe(502)
  })
  it('the setup wizard may link WhatsApp and look at its state, and call nothing else', async () => {
    const env = makeWebEnv(); const token = env.sys.setup.ensureToken()!
    const jar = new Jar(); await call(setup.token, { path: '/api/setup/token', body: { token }, jar })
    for (const m of ['getStatus', 'getSelfNumber', 'connect', 'logout']) expect((await call(rpcRoute, { path: `/api/rpc/${m}`, body: { args: [] }, jar })).status, m).toBe(200)
    for (const m of ['getSettings', 'listChats', 'getThread', 'saveApiKey', 'setBotEnabled', 'eraseCustomer', 'listFiles', 'getDashboard', 'getLog'])
      expect((await call(rpcRoute, { path: `/api/rpc/${m}`, body: { args: [] }, jar })).status, m).toBe(403)
  })
  it('the wizard session stops working, for RPC and for events, once the owner exists', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    const headers = { cookie: `setup=${encodeURIComponent(o.setupCookie)}` } // the cookie the wizard held before finishing
    expect((await call(rpcRoute, { path: '/api/rpc/getStatus', body: { args: [] }, headers })).status).toBe(401)
    expect((await call(events, { method: 'GET', path: '/api/events', headers })).status).toBe(401)
  })
})

describe('live events (/api/events)', () => {
  it('needs a session', async () => {
    makeWebEnv()
    expect((await call(events, { method: 'GET', path: '/api/events' })).status).toBe(401)
  })
  it('gives the owner everything the worker emits', async () => {
    const env = makeWebEnv(); const o = await wizard(env); const jar = await loginHttp(env, o, new Jar())
    const res = await call(events, { method: 'GET', path: '/api/events', jar })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    const text = await readUntil(res, 'rahasia pelanggan')
    expect(text).toContain('event: evt:status'); expect(text).toContain('event: evt:message')
  })
  it('gives the setup wizard the connection state only, never a customer message', async () => {
    const env = makeWebEnv(); const token = env.sys.setup.ensureToken()!
    const jar = new Jar(); await call(setup.token, { path: '/api/setup/token', body: { token }, jar })
    const res = await call(events, { method: 'GET', path: '/api/events', jar })
    const text = await readUntil(res, ': hb')
    expect(text).toContain('event: evt:status')
    expect(text).not.toContain('evt:message'); expect(text).not.toContain('rahasia pelanggan')
  })
})

async function readUntil(res: Response, needle: string): Promise<string> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ''
  const end = Date.now() + 2000
  while (!buf.includes(needle) && Date.now() < end) {
    const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 300))])
    if (done) break
    buf += dec.decode(value)
  }
  await reader.cancel().catch(() => undefined)
  return buf
}

describe('knowledge files', () => {
  const owner = async () => { const env = makeWebEnv(); const o = await wizard(env); return { env, jar: await loginHttp(env, o, new Jar()) } }
  const form = (files: { name: string; text: string }[]) => { const f = new FormData(); for (const x of files) f.append('files', new File([x.text], x.name)); return f }
  const up = (jar: Jar | undefined, f: FormData, extra: Record<string, string> = {}) =>
    call(kb.upload, { path: '/api/knowledge/upload', raw: f as never, jar, headers: { 'content-length': '2000', ...extra } })

  it('forwards each uploaded file to the worker', async () => {
    const { env, jar } = await owner()
    const r = await json(await up(jar, form([{ name: 'a.md', text: 'isi a' }, { name: 'b.txt', text: 'isi b' }])))
    expect(r).toEqual({ ok: true, added: ['a.md', 'b.txt'], rejected: [] })
    expect(env.worker.uploads.map((u) => u.name)).toEqual(['a.md', 'b.txt'])
  })
  it('needs the owner', async () => {
    makeWebEnv()
    expect((await up(undefined, form([{ name: 'a.md', text: 'x' }]))).status).toBe(401)
  })
  it('refuses an upload that is too big, of unknown size, empty, or with too many files', async () => {
    const { jar } = await owner()
    expect((await up(jar, form([{ name: 'a.md', text: 'x' }]), { 'content-length': String(26 * 1024 * 1024) })).status).toBe(413)
    expect((await up(jar, form([{ name: 'a.md', text: 'x' }]), { 'content-length': '0' })).status).toBe(400)
    expect((await up(jar, new FormData())).status).toBe(400)
    expect((await up(jar, form(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.md`, text: 'x' }))))).status).toBe(400)
  })
  it('downloads a file as an attachment, and says 404 for anything else', async () => {
    const { jar } = await owner()
    const ok = await call(kb.download, { method: 'GET', path: '/api/knowledge/download?name=ada.md', jar })
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('isi berkas')
    expect(ok.headers.get('content-disposition')).toContain('attachment')
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
    for (const n of ['', 'tidak-ada.md']) expect((await call(kb.download, { method: 'GET', path: `/api/knowledge/download?name=${n}`, jar })).status).toBe(404)
    expect((await call(kb.download, { method: 'GET', path: '/api/knowledge/download?name=ada.md' })).status).toBe(401)
  })
})

describe('public endpoints', () => {
  it('say only whether setup is finished and whether WhatsApp is up', async () => {
    const env = makeWebEnv()
    expect(await json(await call(pub.authStatus, { method: 'GET', path: '/api/public/auth-status' }))).toEqual({ ok: true, setupComplete: false, waConnected: true })
    await wizard(env)
    env.worker.wa = 'disconnected'
    expect(await json(await call(pub.authStatus, { method: 'GET', path: '/api/public/auth-status' }))).toEqual({ ok: true, setupComplete: true, waConnected: false })
  })
  it('health reports the worker without secrets and works with no session', async () => {
    makeWebEnv()
    const h = await json(await call(pub.health, { method: 'GET', path: '/api/health' }))
    expect(h).toMatchObject({ ok: true, worker: { ok: true, wa: 'connected' } })
  })
})

describe('which address a request counts as coming from', () => {
  it('ignores X-Forwarded-For when no proxy is trusted, so it cannot be used to dodge the limits', async () => {
    makeWebEnv({ hops: 0 })
    for (let i = 0; i < 5; i++) await call(auth.forgot, { path: '/api/auth/forgot', body: { username: 'x' }, headers: { 'x-forwarded-for': `9.9.9.${i}` } })
    expect((await call(auth.forgot, { path: '/api/auth/forgot', body: { username: 'x' }, headers: { 'x-forwarded-for': '8.8.8.8' } })).status).toBe(429)
  })
  it('with one trusted proxy, uses the address the proxy added (the last one), so a forged first entry changes nothing', async () => {
    makeWebEnv({ hops: 1 })
    for (let i = 0; i < 5; i++) await call(auth.forgot, { path: '/api/auth/forgot', body: { username: 'x' }, headers: { 'x-forwarded-for': `forged-${i}, 5.5.5.5` } })
    expect((await call(auth.forgot, { path: '/api/auth/forgot', body: { username: 'x' }, headers: { 'x-forwarded-for': 'forged-new, 5.5.5.5' } })).status).toBe(429)
    expect((await call(auth.forgot, { path: '/api/auth/forgot', body: { username: 'x' }, headers: { 'x-forwarded-for': 'forged-new, 6.6.6.6' } })).status).toBe(200)
  })
})

describe('polling is not activity', () => {
  const poll = (jar: Jar) => call(rpcRoute, { path: '/api/rpc/getDashboard', body: { args: [] }, jar })
  it('a screen that only polls is signed out at the idle limit, however often it polls', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    env.worker.rpcAnswer = () => ({ ok: true, data: {} })
    const jar = await loginHttp(env, o, new Jar())
    env.clock.advance(10 * 60_000); expect((await poll(jar)).status).toBe(200)
    env.clock.advance(10 * 60_000); expect((await poll(jar)).status).toBe(200)
    env.clock.advance(11 * 60_000); expect((await poll(jar)).status).toBe(401) // 31 minutes after the sign-in
  })
  it('a real action in between keeps the session going', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    env.worker.rpcAnswer = () => ({ ok: true, data: {} })
    const jar = await loginHttp(env, o, new Jar())
    env.clock.advance(20 * 60_000); expect((await call(rpcRoute, { path: '/api/rpc/getSettings', body: { args: [] }, jar })).status).toBe(200)
    env.clock.advance(11 * 60_000); expect((await poll(jar)).status).toBe(200) // 31 min after sign-in, only 11 after the action
    env.clock.advance(15 * 60_000); expect((await poll(jar)).status).toBe(200) // 26 after the action
    env.clock.advance(5 * 60_000); expect((await poll(jar)).status).toBe(401) // 31 after the last real action
  })
  it('asking who is signed in, or holding the event stream open, is not activity either', async () => {
    const env = makeWebEnv(); const o = await wizard(env)
    const jar = await loginHttp(env, o, new Jar())
    for (let i = 0; i < 2; i++) { env.clock.advance(10 * 60_000); expect((await call(auth.session, { method: 'GET', path: '/api/auth/session', jar })).status).toBe(200) }
    env.clock.advance(11 * 60_000)
    expect((await call(auth.session, { method: 'GET', path: '/api/auth/session', jar })).status).toBe(401)
  })
})
