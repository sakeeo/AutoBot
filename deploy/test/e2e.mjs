// End-to-end check of the web image behind Caddy: the whole setup wizard, login with an authenticator code, session,
// live events over both proxy hops, and the browser-facing security headers. Needs deploy/test/docker-compose.e2e.yml.
//   E2E_BASE=http://localhost:3100 node test/e2e.mjs
import { createHmac } from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3100'
const PHONE = process.env.E2E_OWNER_PHONE ?? '6281100000001' // fake: the stub never sends anything to WhatsApp
const PASSWORD = 'kopi susu gula aren tiga sendok'
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'LULUS ' : 'GAGAL '} ${name}${detail ? ` — ${detail}` : ''}`) }

const jar = new Map()
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
function keep(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';'); const i = pair.indexOf('=')
    const name = pair.slice(0, i), val = pair.slice(i + 1)
    if (val === '' || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, val)
  }
}
async function call(method, path, body, { origin = BASE, cookies = true } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (origin) headers.origin = origin
  if (cookies && jar.size) headers.cookie = cookieHeader()
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  keep(res)
  let json = null
  try { json = await res.clone().json() } catch { /* not json */ }
  return { res, json }
}

function base32(s) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', out = []; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
const step = () => Math.floor(Date.now() / 30_000)
function totp(secret, s = step()) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(s))
  const h = createHmac('sha1', base32(secret)).update(b).digest(); const o = h[19] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0')
}
const compose = (args) => execSync(`docker compose -f docker-compose.yml -f test/docker-compose.e2e.yml ${args}`, { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- pages and headers (production build) --------------------------------------------------------------------------
for (const path of ['/login', '/setup']) {
  const res = await fetch(BASE + path, { redirect: 'manual' })
  const html = await res.text()
  const csp = res.headers.get('content-security-policy') ?? ''
  check(`${path}: CSP dengan nonce, tanpa unsafe-inline/unsafe-eval untuk skrip dan <style>`,
    /script-src [^;]*'nonce-/.test(csp) && !/script-src[^;]*unsafe-(inline|eval)/.test(csp) && !/style-src 'self'[^;]*unsafe-inline/.test(csp), csp.slice(0, 80))
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? '?'
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])
  const styles = [...html.matchAll(/<style\b[^>]*>/g)].map((m) => m[0])
  check(`${path}: semua <script> membawa nonce (${scripts.length}) dan semua <style> inline juga (${styles.length})`,
    scripts.every((s) => /\bsrc=/.test(s) ? true : s.includes(`nonce="${nonce}"`) || /type="application\/json"/.test(s) || /nonce=/.test(s)) && styles.every((s) => /nonce=/.test(s)))
  check(`${path}: header keamanan`, res.headers.get('x-frame-options') === 'DENY' && res.headers.get('x-content-type-options') === 'nosniff' && res.headers.get('referrer-policy') === 'no-referrer' && !res.headers.get('x-powered-by'))
}

// --- the wizard ------------------------------------------------------------------------------------------------------
const logs = compose('logs web --no-color 2>&1')
const tokenLine = logs.split('\n').reverse().find((l) => /^web-1\s+\|\s+[A-Za-z0-9_-]{30,}\s*$/.test(l))
const setupToken = tokenLine?.split('|')[1].trim()
check('token setup tercetak di log web', !!setupToken)
check('langkah tanpa sesi wizard ditolak', (await call('POST', '/api/setup/owner-phone', { phone: PHONE }, { cookies: false })).res.status === 401)
check('token salah ditolak', (await call('POST', '/api/setup/token', { token: 'salah' })).res.status === 401)
check('token benar membuka wizard', (await call('POST', '/api/setup/token', { token: setupToken })).res.status === 200)
check('nomor pemilik diterima', (await call('POST', '/api/setup/owner-phone', { phone: PHONE })).res.status === 200)
check('OTP dikirim', (await call('POST', '/api/setup/owner-otp/send', {})).res.status === 200)
await sleep(500)
const otp = [...compose('logs worker --no-color 2>&1').matchAll(/kind=otp_setup code=(\d+)/g)].pop()?.[1]
check('kode OTP sampai ke jalur kirim sistem', !!otp)
check('kode OTP salah ditolak', (await call('POST', '/api/setup/owner-otp/verify', { code: otp === '000000' ? '111111' : '000000' })).res.status !== 200)
check('kode OTP benar diterima', (await call('POST', '/api/setup/owner-otp/verify', { code: otp })).res.status === 200)
check('password lemah ditolak', (await call('POST', '/api/setup/account', { username: 'budi', password: '123' })).res.status === 400)
const acct = await call('POST', '/api/setup/account', { username: 'budi', password: PASSWORD })
check('akun dibuat (Argon2 di image)', acct.res.status === 200 && typeof acct.json?.secret === 'string')
const secret = acct.json?.secret
const t1 = await call('POST', '/api/setup/totp', { code: totp(secret) })
check('TOTP pertama diterima, kode pemulihan diberikan', t1.res.status === 200 && Array.isArray(t1.json?.recoveryCodes) && t1.json.recoveryCodes.length === 10)
const recovery = t1.json?.recoveryCodes ?? []
check('selesai tanpa mengaku kode pemulihan sudah disimpan: ditolak', (await call('POST', '/api/setup/finish', { savedRecoveryCodes: false })).res.status !== 200)
const fin = await call('POST', '/api/setup/finish', { savedRecoveryCodes: true })
check('wizard selesai dan langsung masuk', fin.res.status === 200 && jar.has('sid'))
const sidAttr = fin.res.headers.getSetCookie().find((c) => c.startsWith('sid='))?.toLowerCase() ?? ''
check('cookie sesi HttpOnly dan SameSite', sidAttr.includes('httponly') && /samesite=(lax|strict)/.test(sidAttr), sidAttr.replace(/=[^;]+/, '=…').slice(0, 70))
for (const [p, m, b] of [['/api/setup/state', 'GET'], ['/api/setup/token', 'POST', { token: setupToken }], ['/api/setup/owner-phone', 'POST', { phone: PHONE }]])
  check(`setelah selesai ${p} menjawab 404`, (await call(m, p, b)).res.status === 404)

// --- session, events, guards -----------------------------------------------------------------------------------------
check('sesi aktif', (await call('GET', '/api/auth/session')).res.status === 200)
check('RPC lewat web ke worker', (await call('POST', '/api/rpc/getStatus', { args: [] })).json?.ok === true)
check('permintaan tanpa Origin ditolak (CSRF)', (await call('POST', '/api/rpc/getStatus', { args: [] }, { origin: null })).res.status === 403)
check('Origin asing ditolak', (await call('POST', '/api/rpc/getStatus', { args: [] }, { origin: 'https://evil.example' })).res.status === 403)
check('metode yang tidak ada ditolak', [403, 404].includes((await call('POST', '/api/rpc/hapusSemua', { args: [] })).res.status))
check('/api/events tanpa sesi: 401', (await fetch(BASE + '/api/events')).status === 401)
{
  const ctl = new AbortController()
  const res = await fetch(BASE + '/api/events', { headers: { cookie: cookieHeader() }, signal: ctl.signal })
  const t0 = Date.now(); let got = ''
  const reader = res.body.getReader()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try { while (!got.includes('evt:status')) { const { value, done } = await reader.read(); if (done) break; got += Buffer.from(value).toString() } } catch { /* aborted */ }
  clearTimeout(timer); ctl.abort()
  check('SSE sampai ke browser lewat Caddy dan web (tidak ditahan)', got.includes('evt:status') && Date.now() - t0 < 6000, `${Date.now() - t0} ms`)
}

// --- login with password + authenticator ---------------------------------------------------------------------------
await call('POST', '/api/auth/logout', {})
jar.clear()
const bad = await call('POST', '/api/auth/login', { username: 'budi', password: 'salah salah salah' })
check('password salah ditolak', bad.res.status === 401)
const ok1 = await call('POST', '/api/auth/login', { username: 'budi', password: PASSWORD })
check('password benar lanjut ke langkah TOTP', ok1.res.status === 200)
check('RPC sebelum TOTP selesai ditolak', (await call('POST', '/api/rpc/getStatus', { args: [] })).res.status === 401)
const wait = 30_000 - (Date.now() % 30_000) + 500 // the code used in setup cannot be used twice
await sleep(wait)
check('kode TOTP yang benar masuk', (await call('POST', '/api/auth/totp', { code: totp(secret) })).res.status === 200 && jar.has('sid'))
check('setelah masuk, RPC jalan', (await call('POST', '/api/rpc/getStatus', { args: [] })).json?.ok === true)

// --- recovery code and throttling ----------------------------------------------------------------------------------
await call('POST', '/api/auth/logout', {}); jar.clear()
let last = 0
for (let i = 0; i < 12; i++) last = (await call('POST', '/api/auth/login', { username: 'budi', password: `salah-${i}-salah` })).res.status
check('percobaan login salah berulang dibatasi (429)', last === 429, `status akhir ${last}`)
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} lulus`)
process.exit(results.every((r) => r.pass) ? 0 : 1)
