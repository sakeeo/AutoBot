import { z } from 'zod'
import type { Session } from './auth/sessions'
import type { Ctx, ErrorCode, Fail } from './auth/types'
import { getRuntime, type Runtime } from './runtime'

const STATUS: Record<ErrorCode, number> = {
  BAD_CREDENTIALS: 401, THROTTLED: 429, SESSION_EXPIRED: 401, INVALID_CODE: 400, VALIDATION: 400, FORBIDDEN: 403,
  CONFLICT: 409, WA_UNAVAILABLE: 503, NOT_FOUND: 404, STEP_UP_REQUIRED: 403, OTP_UNAVAILABLE: 429
}
export const statusOf = (code: ErrorCode): number => STATUS[code]

export type CookieKind = 'sid' | 'pend' | 'reset' | 'setup'
const MAX_AGE: Record<CookieKind, number | null> = { sid: null, pend: 300, reset: 600, setup: 4 * 3600 }

export function cookieName(rt: Runtime, kind: CookieKind): string {
  return `${rt.config.secure ? '__Host-' : ''}${kind}`
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie')
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}

function setCookie(rt: Runtime, kind: CookieKind, value: string, maxAgeSec: number | null): string {
  const attrs = [`${cookieName(rt, kind)}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', kind === 'sid' ? 'SameSite=Lax' : 'SameSite=Strict']
  if (rt.config.secure) attrs.push('Secure')
  if (maxAgeSec !== null) attrs.push(`Max-Age=${maxAgeSec}`)
  return attrs.join('; ')
}

export interface Reply { status?: number; body: unknown; set?: { kind: CookieKind; value: string }[]; clear?: CookieKind[] }

/** A JSON response that is never cached and carries the cookies to set or clear. */
export function reply(rt: Runtime, r: Reply): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  for (const c of r.set ?? []) headers.append('set-cookie', setCookie(rt, c.kind, c.value, MAX_AGE[c.kind]))
  for (const k of r.clear ?? []) headers.append('set-cookie', setCookie(rt, k, '', 0))
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers })
}

export function failure(rt: Runtime, f: Fail, extra: Omit<Reply, 'body' | 'status'> = {}): Response {
  const headers: Record<string, string> = {}
  if (f.retryAfterSec) headers['retry-after'] = String(f.retryAfterSec)
  const res = reply(rt, { status: statusOf(f.code), body: { ok: false, code: f.code, message: f.message, retryAfterSec: f.retryAfterSec }, ...extra })
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
  return res
}

/** Where the request really came from: the socket address is not visible to route handlers, so only a trusted proxy's header counts. */
export function clientCtx(rt: Runtime, req: Request): Ctx {
  const hops = rt.config.trustedProxyHops
  let ip = 'direct'
  if (hops > 0) {
    const chain = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    // the proxy appends the address it saw, so the entry `hops` from the right is the client
    ip = chain[chain.length - hops] ?? 'unknown'
  }
  return { ip, ipHash: rt.sys.keys.hmac('ip', ip).slice(0, 32), userAgent: req.headers.get('user-agent') ?? '' }
}

/**
 * Refuses a state-changing request that did not come from this site's own pages. A browser always says where a request
 * started (Origin, or Sec-Fetch-Site); a request that says neither is not from a browser page and is refused too.
 */
export function sameSite(rt: Runtime, req: Request): boolean {
  const origin = req.headers.get('origin')
  if (origin) return origin === rt.config.appUrl.origin
  const site = req.headers.get('sec-fetch-site')
  return site === 'same-origin' || site === 'none'
}

export async function readJson<S extends z.ZodTypeAny>(req: Request, schema: S, maxBytes = 20_000): Promise<{ ok: true; data: z.infer<S> } | { ok: false }> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return { ok: false }
  const text = await req.text()
  if (text.length > maxBytes) return { ok: false }
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false }
  } catch {
    return { ok: false }
  }
}

const BAD_REQUEST: Fail = { ok: false, code: 'VALIDATION', message: 'Permintaan tidak valid.' }

export type Handler<B> = (a: { req: Request; rt: Runtime; ctx: Ctx; body: B }) => Promise<Response> | Response

/**
 * Wraps a route: same-site check for anything that changes state, a JSON body checked against a schema, and one place
 * where an unexpected error becomes a generic 500 (the cause goes to the server log only).
 */
export function route<S extends z.ZodTypeAny>(opts: { schema?: S; maxBytes?: number }, fn: Handler<S extends z.ZodTypeAny ? z.infer<S> : undefined>) {
  return async (req: Request): Promise<Response> => {
    const rt = getRuntime()
    try {
      if (!['GET', 'HEAD'].includes(req.method) && !sameSite(rt, req)) return failure(rt, { ok: false, code: 'FORBIDDEN', message: 'Permintaan ditolak.' })
      let body: unknown = undefined
      if (opts.schema) {
        const parsed = await readJson(req, opts.schema, opts.maxBytes)
        if (!parsed.ok) return failure(rt, BAD_REQUEST)
        body = parsed.data
      }
      return await fn({ req, rt, ctx: clientCtx(rt, req), body: body as never })
    } catch (e) {
      console.error('route failed:', e instanceof Error ? e.message : 'unknown')
      return reply(rt, { status: 500, body: { ok: false, code: 'INTERNAL', message: 'Terjadi kesalahan di server.' } })
    }
  }
}

export type OwnerGuard = { ok: true; session: Session } | { ok: false; res: Response }

/** The signed-in owner of this request. A session limited to setting up a new authenticator passes only when `allowRestricted`. */
export function requireOwner(rt: Runtime, req: Request, o: { allowRestricted?: boolean; touch?: boolean } = {}): OwnerGuard {
  const session = rt.sys.auth.owner(readCookie(req, cookieName(rt, 'sid')), o.touch ?? true)
  if (!session) return { ok: false, res: failure(rt, { ok: false, code: 'SESSION_EXPIRED', message: 'Silakan masuk lagi.' }) }
  if (session.restricted && !o.allowRestricted)
    return { ok: false, res: failure(rt, { ok: false, code: 'FORBIDDEN', message: 'Daftarkan authenticator baru dulu.' }) }
  return { ok: true, session }
}

