import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import pino from 'pino'
import { createEngine, type Engine } from '../src/engine'
import { createWorkerServer } from '../src/server'
import { FakeGateway } from './helpers/fake-gateway'
import { makeDir } from './helpers/fixtures'

const TOKEN = 'k'.repeat(48)
let engine: Engine, gateway: FakeGateway, server: Server, base: string
const logged: unknown[] = []

beforeEach(async () => {
  gateway = new FakeGateway()
  engine = await createEngine({ dataDir: makeDir('wa-srv-'), secretKey: randomBytes(32), gateway, logger: pino({ level: 'silent' }) })
  await engine.ready
  server = createWorkerServer(engine, {
    token: TOKEN, heartbeatMs: 50,
    logger: pino({ level: 'error' }, { write: (s: string) => { logged.push(s) } })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
  await engine.shutdown()
  logged.length = 0
})

const auth = { 'x-worker-token': TOKEN }
const rpc = (method: string, args: unknown[] = [], headers: Record<string, string> = auth) =>
  fetch(`${base}/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ args }) })

describe('authentication', () => {
  it('serves /health without a token, and nothing else', async () => {
    const r = await fetch(`${base}/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, botEnabled: false })
    for (const [m, p] of [['POST', '/rpc/getSettings'], ['POST', '/system-send'], ['PUT', '/knowledge/files?name=a.md'], ['GET', '/knowledge/download?name=a.md'], ['GET', '/events']])
      expect((await fetch(`${base}${p}`, { method: m })).status, `${m} ${p}`).toBe(401)
  })
  it('rejects a wrong token, an empty token, and a token of the wrong length', async () => {
    for (const t of ['', 'x', TOKEN.slice(0, -1), TOKEN + 'x', TOKEN.toUpperCase()])
      expect((await rpc('getSettings', [], { 'x-worker-token': t })).status, t).toBe(401)
  })
  it('does not leak what failed in the 401 body', async () => {
    const r = await rpc('getSettings', [], {})
    expect(await r.json()).toEqual({ ok: false, code: 'UNAUTHENTICATED', message: 'Tidak diizinkan.' })
  })
})

describe('/rpc', () => {
  it('calls an engine method and wraps the result', async () => {
    const r = await rpc('getSettings')
    expect(r.status).toBe(200)
    const body = await r.json() as { ok: boolean; data: { mode: string } }
    expect(body.ok).toBe(true)
    expect(body.data.mode).toBe('extractive')
  })
  it('passes arguments through and the method validates them (zod → 400 VALIDATION)', async () => {
    expect((await rpc('updateSettings', [{ threshold: 0.7 }])).status).toBe(200)
    const bad = await rpc('updateSettings', [{ threshold: 9 }])
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ ok: false, code: 'VALIDATION', message: 'Data tidak valid.' })
    expect((await rpc('updateSettings', [{ knowledgeFolders: ['/etc'] }])).status).toBe(400)
  })
  it('404s unknown methods and anything that is not an own method name (no prototype tricks)', async () => {
    for (const m of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'bcOverview', 'authLogin', 'x%2Fy', 'a'.repeat(80)])
      expect((await rpc(m)).status, m).toBe(404)
  })
  it('shows a UserError message to the browser (400 REJECTED, 404 for not-found)', async () => {
    const r = await rpc('setBotEnabled', ['ya'])
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ ok: false, code: 'REJECTED', message: 'Nilai harus true atau false.' })
    expect((await rpc('kbDelete', ['tidak-ada.md'])).status).toBe(404)
  })
  it('hides internal errors: no SQL, path or stack in the response, but the cause is logged on the server', async () => {
    engine.rpc.boom = () => { throw new Error('SELECT * FROM secrets WHERE path=/home/x/.env') }
    const r = await rpc('boom')
    expect(r.status).toBe(500)
    const text = await r.text()
    expect(JSON.parse(text)).toEqual({ ok: false, code: 'INTERNAL', message: 'Terjadi kesalahan di server.' })
    expect(text).not.toMatch(/SELECT|\/home|at .*\(.*\)/)
    expect(logged.join('')).toContain('SELECT')
  })
  it('wants JSON, bounds the body, and rejects malformed JSON', async () => {
    const plain = await fetch(`${base}/rpc/getSettings`, { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: '{}' })
    expect(plain.status).toBe(415)
    const big = await fetch(`${base}/rpc/getSettings`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ args: ['x'.repeat(1_200_000)] }) })
    expect(big.status).toBe(413)
    const broken = await fetch(`${base}/rpc/getSettings`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{oops' })
    expect(broken.status).toBe(400)
  })
  it('refuses more than eight arguments and a non-array args', async () => {
    expect((await rpc('getSettings', Array(9).fill(1))).status).toBe(400)
    const r = await fetch(`${base}/rpc/getSettings`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ args: 'x' }) })
    expect(r.status).toBe(400)
  })
})

describe('/system-send', () => {
  it('sends a verification code through WhatsApp and never echoes it back', async () => {
    gateway.emitStatus({ state: 'connected' })
    const r = await fetch(`${base}/system-send`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ to: '6281234567890', kind: 'otp_reset', code: '552901' }) })
    const text = await r.text()
    expect(JSON.parse(text)).toEqual({ ok: true })
    expect(text).not.toContain('552901')
    expect(gateway.sent[0].text).toContain('552901')
    expect(logged.join('')).not.toContain('552901')
  })
  it('refuses free text, extra fields and unknown kinds', async () => {
    gateway.emitStatus({ state: 'connected' })
    for (const body of [{ to: '6281234567890', kind: 'otp_setup', code: '123456', text: 'halo' }, { to: '6281234567890', kind: 'iklan' }, { kind: 'otp_setup' }])
      expect((await fetch(`${base}/system-send`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, JSON.stringify(body)).toBe(400)
    expect(gateway.sent).toEqual([])
  })
  it('reports a business failure as JSON with 200 (WhatsApp not connected)', async () => {
    const r = await fetch(`${base}/system-send`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ to: '6281234567890', kind: 'otp_setup', code: '123456' }) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: false, code: 'WA_DISCONNECTED' })
  })
})

describe('knowledge upload and download', () => {
  const put = (name: string, body: BodyInit) => fetch(`${base}/knowledge/files?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: auth, body })
  it('stores an upload, indexes it, lists it by name, and serves it back as an attachment', async () => {
    const r = await put('harga.md', 'Kopi susu Rp25.000')
    expect(await r.json()).toEqual({ ok: true, data: { added: ['harga.md'], rejected: [] } })
    const list = (await (await rpc('listFiles')).json()) as { data: { file: string; status: string }[] }
    expect(list.data).toEqual([expect.objectContaining({ file: 'harga.md', status: 'indexed' })])
    const d = await fetch(`${base}/knowledge/download?name=harga.md`, { headers: auth })
    expect(d.status).toBe(200)
    expect(await d.text()).toBe('Kopi susu Rp25.000')
    expect(d.headers.get('content-disposition')).toMatch(/^attachment; filename\*=UTF-8''harga\.md$/)
    expect(d.headers.get('x-content-type-options')).toBe('nosniff')
    expect(d.headers.get('content-type')).toBe('application/octet-stream')
  })
  it('rejects secrets and unsupported files, sanitises path names, and refuses a missing name', async () => {
    expect(await (await put('.env', 'RAHASIA=1')).json()).toMatchObject({ data: { added: [], rejected: [{ name: '.env' }] } })
    expect(await (await put('../../escape.md', 'x')).json()).toMatchObject({ data: { added: ['escape.md'] } })
    expect((await fetch(`${base}/knowledge/files`, { method: 'PUT', headers: auth, body: 'x' })).status).toBe(400)
  })
  it('refuses an upload over the limit without reading it all', async () => {
    const r = await put('besar.txt', Buffer.alloc(20 * 1024 * 1024 + 10, 97))
    expect(r.status).toBe(413)
  })
  it('404s a download that is not an indexed file inside the folder', async () => {
    for (const n of ['', 'tidak-ada.md', '../autobot.db', '../../etc/passwd', '/etc/passwd'])
      expect((await fetch(`${base}/knowledge/download?name=${encodeURIComponent(n)}`, { headers: auth })).status, n).toBe(404)
  })
})

describe('/events (server-sent events)', () => {
  async function open() {
    const ctl = new AbortController()
    const res = await fetch(`${base}/events`, { headers: auth, signal: ctl.signal })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    const until = async (needle: string, ms = 2000): Promise<string> => {
      const end = Date.now() + ms
      while (!buf.includes(needle)) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${needle}; got ${buf}`)
        const { value, done } = await Promise.race([reader.read(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('read timeout')), 500))]).catch(() => ({ value: undefined, done: false }))
        if (done) break
        if (value) buf += dec.decode(value)
      }
      return buf
    }
    return { res, until, close: () => ctl.abort() }
  }
  it('sends the current status at once, then live events with the contract channel names, and a heartbeat', async () => {
    const s = await open()
    expect(s.res.headers.get('content-type')).toContain('text/event-stream')
    expect(s.res.headers.get('x-accel-buffering')).toBe('no')
    await s.until('event: evt:status')
    gateway.emitStatus({ state: 'waiting_qr', qr: 'QR-1' })
    const got = await s.until('QR-1')
    expect(got).toContain('event: evt:status\ndata: {"state":"waiting_qr","qr":"QR-1"}')
    await s.until(': hb')
    s.close()
  })
  it('stops listening when the client goes away', async () => {
    const before = engine.events.listenerCount('evt:status')
    const s = await open()
    await s.until('event: evt:status')
    expect(engine.events.listenerCount('evt:status')).toBe(before + 1)
    s.close()
    for (let i = 0; i < 40 && engine.events.listenerCount('evt:status') !== before; i++) await new Promise((r) => setTimeout(r, 25))
    expect(engine.events.listenerCount('evt:status')).toBe(before)
  })
})
