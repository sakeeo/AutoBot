import { randomBytes } from 'node:crypto'
import { openAuthDb } from '../src/server/auth/db'
import { Keys } from '../src/server/auth/crypto'

export interface TestClock { t: number; now(): number; advance(ms: number): void }

export function makeClock(start = 1_700_000_000_000): TestClock {
  return { t: start, now() { return this.t }, advance(ms: number) { this.t += ms } }
}

export function makeBase() {
  const db = openAuthDb(':memory:')
  const keys = new Keys(randomBytes(32))
  const clock = makeClock()
  return { db, keys, clock }
}

import { createAuthSystem, type AuthSystem } from '../src/server/auth'
import type { Ctx, WorkerPort } from '../src/server/auth/types'
import { hotp, base32Decode, stepAt } from '../src/server/auth/totp'

export class FakeWorker implements WorkerPort {
  self: string | null = '6285119308345'
  sent: { to: string; kind: string; code?: string; username?: string; last4?: string }[] = []
  failWith: string | null = null
  down = false
  async selfNumber(): Promise<string | null> { if (this.down) throw new Error('worker down'); return this.self }
  async systemSend(req: { to: string; kind: string; code?: string; username?: string; last4?: string }) {
    if (this.down) throw new Error('worker down')
    if (this.failWith) return { ok: false as const, code: this.failWith }
    this.sent.push(req)
    return { ok: true as const }
  }
  last(kind?: string) { return [...this.sent].reverse().find((s) => !kind || s.kind === kind) }
}

export const OWNER_PHONE = '6281234567890'
export const ctx = (ip = '10.0.0.1', userAgent = 'Firefox/test'): Ctx => ({ ip, ipHash: `h:${ip}`, userAgent })

export function makeEnv() {
  const base = makeBase()
  const worker = new FakeWorker()
  const sys: AuthSystem = createAuthSystem({ db: base.db, secretKey: randomBytes(32), worker, clock: base.clock })
  // the same key the system derived, so tests can compute authenticator codes
  const codeFor = (secretBase32: string, ms = base.clock.now()) => hotp(base32Decode(secretBase32), stepAt(ms))
  return { ...base, worker, sys, codeFor }
}
export type Env = ReturnType<typeof makeEnv>

/** Runs the whole wizard and returns what a person would have kept: password, TOTP secret and recovery codes. */
export async function createOwner(env: Env, o: { username?: string; password?: string; phone?: string } = {}) {
  const username = o.username ?? 'budi'
  const password = o.password ?? 'kopi susu gula aren tiga sendok'
  const phone = o.phone ?? OWNER_PHONE
  const { setup } = env.sys
  const token = setup.ensureToken()!
  const entered = setup.submitToken(token, ctx())
  if (!entered.ok) throw new Error('token')
  const a = await setup.setOwnerPhone(phone); if (!a.ok) throw new Error(a.message)
  const b = await setup.sendOwnerOtp(ctx()); if (!b.ok) throw new Error(b.message)
  const c = setup.verifyOwnerOtp(env.worker.last('otp_setup')!.code!, ctx()); if (!c.ok) throw new Error(c.message)
  const d = await setup.setAccount(username, password); if (!d.ok) throw new Error(d.message)
  const e = setup.verifyTotp(env.codeFor(d.secret), ctx()); if (!e.ok) throw new Error(e.message)
  const f = setup.finish(true, ctx()); if (!f.ok) throw new Error(f.message)
  env.worker.sent.length = 0
  return { username, password, phone, secret: d.secret, recoveryCodes: e.recoveryCodes, sessionToken: f.sessionToken, setupToken: token }
}

import { setRuntimeForTests, type Runtime } from '../src/server/runtime'
import type { WebWorker, RpcResult } from '../src/server/worker-client'
import { loadWebConfig } from '../src/server/config'

/** A worker that remembers what it was asked and answers from a script. */
export class FakeWebWorker extends FakeWorker implements WebWorker {
  rpcCalls: { method: string; args: unknown[] }[] = []
  rpcAnswer: (method: string, args: unknown[]) => RpcResult = () => ({ ok: true, data: null })
  uploads: { name: string; size: number }[] = []
  wa = 'connected'
  eventsBody: string | null = null
  async rpc(method: string, args: unknown[]): Promise<RpcResult> {
    this.rpcCalls.push({ method, args })
    if (method === 'getSelfNumber') return { ok: true, data: this.self }
    if (method === 'getStatus') return { ok: true, data: { state: this.wa } }
    return this.rpcAnswer(method, args)
  }
  async upload(name: string, data: Uint8Array): Promise<RpcResult> {
    this.uploads.push({ name, size: data.length })
    return { ok: true, data: { added: [name], rejected: [] } }
  }
  async download(name: string): Promise<Response> {
    return name === 'ada.md' ? new Response('isi berkas', { headers: { 'content-disposition': "attachment; filename*=UTF-8''ada.md" } }) : new Response('x', { status: 404 })
  }
  async events(signal: AbortSignal): Promise<Response> {
    const body = this.eventsBody ?? 'event: evt:status\ndata: {"state":"connected"}\n\nevent: evt:message\ndata: {"text":"rahasia pelanggan"}\n\n: hb\n\n'
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); signal.addEventListener('abort', () => { try { c.close() } catch { /* closed */ } }) } }))
  }
  async health() { return { ok: true, wa: this.wa, botEnabled: false } }
}

export const APP = 'http://localhost:3000'

export function makeWebEnv(opts: { appUrl?: string; hops?: number } = {}) {
  const env = makeEnv()
  const worker = new FakeWebWorker()
  // reuse the auth system built in makeEnv but point it at the richer fake worker
  const sys = createAuthSystem({ db: env.db, secretKey: randomBytes(32), worker, clock: env.clock })
  const config = loadWebConfig({
    APP_URL: opts.appUrl ?? APP, AUTH_SECRET_KEY: 'ab'.repeat(32), WORKER_TOKEN: 'w'.repeat(40),
    TRUSTED_PROXY_HOPS: String(opts.hops ?? 0)
  })
  const rt: Runtime = { config, sys, worker }
  setRuntimeForTests(rt)
  const codeFor = (secret: string) => hotp(base32Decode(secret), stepAt(env.clock.now()))
  return { ...env, worker, sys, rt, config, codeFor }
}
export type WebEnv = ReturnType<typeof makeWebEnv>

/** A same-site browser request: Origin set, cookies carried over from `jar`. */
export function call(handler: (req: Request) => Promise<Response>, o: { method?: string; path: string; body?: unknown; jar?: Jar; origin?: string | null; headers?: Record<string, string>; raw?: BodyInit; type?: string }) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) }
  if (o.origin !== null) headers.origin = o.origin ?? APP
  if (o.jar) headers.cookie = o.jar.header()
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  if (o.type) headers['content-type'] = o.type
  const req = new Request(`${APP}${o.path}`, { method: o.method ?? 'POST', headers, body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined) })
  return handler(req).then(async (res) => {
    o.jar?.absorb(res)
    return res
  })
}
export const json = async (res: Response) => (await res.json()) as Record<string, any>

export class Jar {
  private c = new Map<string, string>()
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim())
      const i = pair.indexOf('=')
      const name = pair.slice(0, i); const value = decodeURIComponent(pair.slice(i + 1))
      if (attrs.some((a) => /^Max-Age=0$/i.test(a)) || value === '') this.c.delete(name)
      else this.c.set(name, value)
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') }
  get(name: string) { return this.c.get(name) }
  names() { return [...this.c.keys()] }
}
