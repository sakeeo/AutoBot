import { z } from 'zod'
import { cookieName, failure, readCookie, reply, route } from '../http'
import type { Runtime } from '../runtime'
import { maskPhone } from '../auth/types'

const NOT_FOUND = { ok: false, code: 'NOT_FOUND', message: 'Tidak ditemukan.' } as const

/** The wizard exists only until the owner does: afterwards every /api/setup route answers 404. */
function setupSession(rt: Runtime, req: Request) {
  if (rt.sys.setup.isComplete()) return { res: failure(rt, NOT_FOUND) }
  const s = rt.sys.sessions.get('setup', readCookie(req, cookieName(rt, 'setup')))
  return s ? { session: s } : { res: failure(rt, { ok: false, code: 'SESSION_EXPIRED', message: 'Masukkan token setup lagi.' }) }
}

export const token = route({ schema: z.object({ token: z.string().min(1).max(200) }).strict() }, ({ rt, ctx, body }) => {
  const r = rt.sys.setup.submitToken(body.token, ctx)
  if (!r.ok) return failure(rt, r)
  return reply(rt, { body: { ok: true }, set: [{ kind: 'setup', value: r.sessionToken }] })
})

export const state = route({}, async ({ rt, req }) => {
  const g = setupSession(rt, req)
  if (g.res) return g.res
  const [status, self] = await Promise.all([rt.worker.rpc('getStatus', []), rt.worker.rpc('getSelfNumber', [])])
  return reply(rt, {
    body: {
      ok: true,
      progress: rt.sys.setup.progress(),
      wa: status.ok ? status.data : { state: 'unknown' },
      botNumber: self.ok && typeof self.data === 'string' ? maskPhone(self.data) : null
    }
  })
})

export const ownerPhone = route({ schema: z.object({ phone: z.string().min(1).max(40) }).strict() }, async ({ rt, req, body }) => {
  const g = setupSession(rt, req)
  if (g.res) return g.res
  const r = await rt.sys.setup.setOwnerPhone(body.phone)
  return r.ok ? reply(rt, { body: { ok: true } }) : failure(rt, r)
})

export const ownerOtpSend = route({ schema: z.object({}).strict() }, async ({ rt, req, ctx }) => {
  const g = setupSession(rt, req)
  if (g.res) return g.res
  const r = await rt.sys.setup.sendOwnerOtp(ctx)
  return r.ok ? reply(rt, { body: r }) : failure(rt, r)
})

export const ownerOtpVerify = route({ schema: z.object({ code: z.string().max(10) }).strict() }, ({ rt, req, ctx, body }) => {
  const g = setupSession(rt, req)
  if (g.res) return g.res
  const r = rt.sys.setup.verifyOwnerOtp(body.code, ctx)
  return r.ok ? reply(rt, { body: { ok: true } }) : failure(rt, r)
})

export const account = route({ schema: z.object({ username: z.string().max(60), password: z.string().max(300) }).strict() }, async ({ rt, req, body }) => {
  const g = setupSession(rt, req)
  if (g.res) return g.res
  const r = await rt.sys.setup.setAccount(body.username, body.password)
  return r.ok ? reply(rt, { body: r }) : failure(rt, r)
})

export const totp = route({ schema: z.object({ code: z.string().max(10) }).strict() }, ({ rt, req, ctx, body }) => {
  const g = setupSession(rt, req)
  if (g.res) return g.res
  const r = rt.sys.setup.verifyTotp(body.code, ctx)
  return r.ok ? reply(rt, { body: r }) : failure(rt, r)
})

export const finish = route({ schema: z.object({ savedRecoveryCodes: z.boolean() }).strict() }, ({ rt, req, ctx, body }) => {
  const g = setupSession(rt, req)
  if (g.res) return g.res
  const r = rt.sys.setup.finish(body.savedRecoveryCodes, ctx)
  if (!r.ok) return failure(rt, r)
  return reply(rt, { body: { ok: true }, set: [{ kind: 'sid', value: r.sessionToken }], clear: ['setup'] })
})
