import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename } from 'node:path'
import type pino from 'pino'
import { z, ZodError } from 'zod'
import { CHANNELS as C } from '@autobot/contracts/channels'
import type { Engine } from './engine'
import { UserError } from './errors'
import { MAX_UPLOAD_BYTES } from './knowledge/files'
import { SYSTEM_KINDS } from './system-send'

/** Events pushed to the web app over /events (names are the contract channel names). */
export const STREAM_EVENTS: string[] = [C.evtStatus, C.evtMessage, C.evtIndexStatus, C.evtEscalate, C.evtHandoff, C.evtKnowledgeSync]
const MAX_STREAMS = 20
const METHOD_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

const SystemSendBody = z.object({
  to: z.string().max(20),
  kind: z.enum(SYSTEM_KINDS as [string, ...string[]]),
  code: z.string().max(10).optional(),
  username: z.string().max(100).optional(),
  last4: z.string().max(10).optional()
}).strict()

export interface WorkerServerOptions {
  token: string
  logger?: pino.Logger
  maxJsonBytes?: number
  heartbeatMs?: number
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest()

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(json)
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, 'TOO_LARGE', 'Permintaan terlalu besar.')
  const chunks: Buffer[] = []
  let n = 0
  for await (const chunk of req) {
    n += (chunk as Buffer).length
    if (n > limit) throw new HttpError(413, 'TOO_LARGE', 'Permintaan terlalu besar.')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
    throw new HttpError(415, 'UNSUPPORTED', 'Content-Type harus application/json.')
  const raw = await readBody(req, limit)
  try {
    return JSON.parse(raw.toString('utf8') || 'null')
  } catch {
    throw new HttpError(400, 'VALIDATION', 'JSON tidak valid.')
  }
}

/**
 * The worker's internal HTTP API. It is reachable only from the web app (a private network), and every route except
 * /health still demands the shared token. Errors never carry a stack, a path or SQL: only UserError text goes out.
 */
export function createWorkerServer(engine: Engine, opts: WorkerServerOptions): Server {
  const tokenDigest = digest(opts.token)
  const maxJson = opts.maxJsonBytes ?? 1_000_000
  const log = opts.logger
  let streams = 0

  const authorised = (req: IncomingMessage): boolean => {
    const given = req.headers['x-worker-token']
    return typeof given === 'string' && timingSafeEqual(digest(given), tokenDigest)
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://worker')
    const path = url.pathname

    if (req.method === 'GET' && path === '/health') return send(res, 200, engine.health())
    if (!authorised(req)) throw new HttpError(401, 'UNAUTHENTICATED', 'Tidak diizinkan.')

    if (req.method === 'POST' && path.startsWith('/rpc/')) {
      const method = decodeURIComponent(path.slice('/rpc/'.length))
      if (!METHOD_NAME.test(method) || !Object.hasOwn(engine.rpc, method)) throw new HttpError(404, 'NOT_FOUND', 'Metode tidak dikenal.')
      const body = (await readJson(req, maxJson)) as { args?: unknown } | null
      const args = body?.args ?? []
      if (!Array.isArray(args) || args.length > 8) throw new HttpError(400, 'VALIDATION', 'args harus berupa array.')
      return send(res, 200, { ok: true, data: (await engine.rpc[method](...args)) ?? null })
    }

    if (req.method === 'POST' && path === '/system-send') {
      const body = SystemSendBody.parse(await readJson(req, 10_000))
      return send(res, 200, await engine.systemSend(body as never))
    }

    if (req.method === 'PUT' && path === '/knowledge/files') {
      const name = url.searchParams.get('name')
      if (!name) throw new HttpError(400, 'VALIDATION', 'Nama berkas wajib diisi.')
      const data = await readBody(req, MAX_UPLOAD_BYTES + 1)
      return send(res, 200, { ok: true, data: await engine.uploadKnowledge([{ name, data }]) })
    }

    if (req.method === 'GET' && path === '/knowledge/download') {
      const file = engine.knowledgeFilePath(url.searchParams.get('name') ?? '')
      const size = statSync(file).size
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': size,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store'
      })
      createReadStream(file).pipe(res)
      return
    }

    if (req.method === 'GET' && path === '/events') return stream(req, res)

    throw new HttpError(404, 'NOT_FOUND', 'Tidak ditemukan.')
  }

  async function stream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (streams >= MAX_STREAMS) throw new HttpError(429, 'RATE_LIMITED', 'Terlalu banyak koneksi.')
    streams++
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    const write = (event: string, data: unknown): void => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    const listeners = STREAM_EVENTS.map((event) => {
      const fn = (payload: unknown): void => write(event, payload)
      engine.events.on(event, fn)
      return [event, fn] as const
    })
    // A reconnecting client gets the current connection state straight away; events are not replayed.
    write(C.evtStatus, await engine.rpc.getStatus())
    const heartbeat = setInterval(() => res.write(': hb\n\n'), opts.heartbeatMs ?? 20_000)
    const close = (): void => {
      clearInterval(heartbeat)
      for (const [event, fn] of listeners) engine.events.off(event, fn)
      streams--
    }
    req.on('close', close)
  }

  return createServer((req, res) => {
    const started = Date.now()
    handle(req, res)
      .catch((e: unknown) => {
        if (res.headersSent) { res.destroy(); return }
        if (e instanceof HttpError) return send(res, e.status, { ok: false, code: e.code, message: e.message })
        if (e instanceof ZodError)
          return send(res, 400, {
            ok: false, code: 'VALIDATION', message: 'Data tidak valid.',
            issues: e.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }))
          })
        if (e instanceof UserError)
          return send(res, e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFLICT' ? 409 : 400, { ok: false, code: e.code, message: e.message })
        log?.error({ err: e, path: req.url?.split('?')[0] }, 'worker request failed')
        send(res, 500, { ok: false, code: 'INTERNAL', message: 'Terjadi kesalahan di server.' })
      })
      .finally(() => log?.debug({ method: req.method, path: req.url?.split('?')[0], status: res.statusCode, ms: Date.now() - started }, 'request'))
  })
}
