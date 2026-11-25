import { z } from 'zod'
import { allowedFor, BACKGROUND_METHODS, STEP_UP_METHODS, type Principal } from '@autobot/contracts/rpc-policy'
import { CHANNELS } from '@autobot/contracts/channels'
import { clientCtx, cookieName, failure, readCookie, reply, route } from '../http'
import type { Runtime } from '../runtime'

/** Changes that are recorded in the audit log (the method name only: arguments can hold a key or a customer's text). */
const AUDITED: ReadonlySet<string> = new Set([
  'gsSaveCredential', 'gsDeleteCredential', 'gsAddSource', 'gsUpdateSource', 'gsRemoveSource', 'gsApproveDomain', 'gsConfirmChange',
  'saveApiKey', 'deleteApiKey', 'setBotEnabled', 'eraseCustomer', 'logout'
])

const METHOD = /^[A-Za-z][A-Za-z0-9]{0,63}$/

/** Who is calling: the signed-in owner, or the first-run wizard before any account exists. */
export function principalOf(rt: Runtime, req: Request, touch = true): { who: Principal; owner?: ReturnType<Runtime['sys']['auth']['owner']> } | { error: Response } {
  const owner = rt.sys.auth.owner(readCookie(req, cookieName(rt, 'sid')), touch)
  if (owner) {
    if (owner.restricted) return { error: failure(rt, { ok: false, code: 'FORBIDDEN', message: 'Daftarkan authenticator baru dulu.' }) }
    return { who: 'owner', owner }
  }
  if (!rt.sys.setup.isComplete() && rt.sys.sessions.get('setup', readCookie(req, cookieName(rt, 'setup')), touch)) return { who: 'setup' }
  return { error: failure(rt, { ok: false, code: 'SESSION_EXPIRED', message: 'Silakan masuk lagi.' }) }
}

/** The one door from the browser to the worker's methods. A method must be in the contract AND allowed for the caller. */
export const rpc = (methodOf: (req: Request) => string) =>
  route({ schema: z.object({ args: z.array(z.unknown()).max(8).default([]) }).strict(), maxBytes: 1_000_000 }, async ({ rt, req, body }) => {
    const method = methodOf(req)
    const p = principalOf(rt, req, !BACKGROUND_METHODS.has(method))
    if ('error' in p) return p.error
    if (!METHOD.test(method) || !Object.hasOwn(CHANNELS, method) || method.startsWith('evt'))
      return failure(rt, { ok: false, code: 'NOT_FOUND', message: 'Metode tidak dikenal.' })
    if (!allowedFor(method, p.who)) return failure(rt, { ok: false, code: 'FORBIDDEN', message: 'Tidak diizinkan.' })
    if (p.who === 'owner' && STEP_UP_METHODS.has(method) && !rt.sys.auth.recentlyReauthed(p.owner!))
      return failure(rt, { ok: false, code: 'STEP_UP_REQUIRED', message: 'Masukkan password Anda untuk melanjutkan.' })
    const r = await rt.worker.rpc(method, body.args)
    if (r.ok) {
      if (AUDITED.has(method)) {
        try { rt.sys.audit.log(`rpc:${method}`, { actor: p.who === 'owner' ? 'owner' : 'setup', ipHash: clientCtx(rt, req).ipHash }) } catch { /* the action is done; a log failure must not undo it */ }
      }
      return reply(rt, { body: { ok: true, data: r.data } })
    }
    return reply(rt, { status: r.status >= 400 && r.status < 600 ? r.status : 502, body: { ok: false, code: r.code, message: r.message, issues: r.issues } })
  })
