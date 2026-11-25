import { z } from 'zod'
import { cookieName, failure, readCookie, reply, requireOwner, route } from '../http'
import type { Runtime } from '../runtime'

const code = z.string().max(40)
const password = z.string().max(300)

const owner = (rt: Runtime, req: Request, allowRestricted = false) => requireOwner(rt, req, { allowRestricted })
const sid = (rt: Runtime, req: Request) => readCookie(req, cookieName(rt, 'sid'))

export const login = route({ schema: z.object({ username: z.string().max(80), password }).strict() }, async ({ rt, ctx, body }) => {
  const r = await rt.sys.auth.login(body.username, body.password, ctx)
  if (!r.ok) return failure(rt, r)
  return reply(rt, { body: { ok: true, enroll: r.enroll ?? null }, set: [{ kind: 'pend', value: r.pendingToken }] })
})

export const totpVerify = route({ schema: z.object({ code }).strict() }, ({ rt, req, ctx, body }) => {
  const r = rt.sys.auth.verifyTotpLogin(readCookie(req, cookieName(rt, 'pend')), body.code, ctx)
  if (!r.ok) return failure(rt, r)
  return reply(rt, { body: { ok: true, recoveryRemaining: r.recoveryRemaining }, set: [{ kind: 'sid', value: r.sessionToken }], clear: ['pend'] })
})

export const recovery = route({ schema: z.object({ code }).strict() }, ({ rt, req, ctx, body }) => {
  const r = rt.sys.auth.loginWithRecovery(readCookie(req, cookieName(rt, 'pend')), body.code, ctx)
  if (!r.ok) return failure(rt, r)
  return reply(rt, { body: { ok: true, restricted: true, recoveryRemaining: r.recoveryRemaining }, set: [{ kind: 'sid', value: r.sessionToken }], clear: ['pend'] })
})

export const logout = route({ schema: z.object({}).strict() }, ({ rt, req }) => {
  rt.sys.auth.logout(sid(rt, req))
  return reply(rt, { body: { ok: true }, clear: ['sid', 'pend', 'reset'] })
})

export const logoutAll = route({ schema: z.object({}).strict() }, ({ rt, req }) => {
  const g = owner(rt, req, true)
  if (!g.ok) return g.res
  rt.sys.auth.logoutAll(g.session)
  return reply(rt, { body: { ok: true }, clear: ['sid', 'pend', 'reset'] })
})

export const session = route({}, ({ rt, req }) => {
  const g = requireOwner(rt, req, { allowRestricted: true, touch: false }) // the screen asks on a timer: not activity
  if (!g.ok) return g.res
  const u = rt.sys.auth.user()
  return reply(rt, {
    body: {
      ok: true, username: u?.username ?? null, restricted: g.session.restricted, expiresAt: g.session.expiresAt,
      reauthRecent: rt.sys.auth.recentlyReauthed(g.session), recoveryWarning: rt.sys.auth.recoveryWarning(),
      ownerPhone: u ? `${u.owner_phone.slice(0, 2)}••••${u.owner_phone.slice(-3)}` : null
    }
  })
})

export const reauth = route({ schema: z.object({ password }).strict() }, async ({ rt, req, ctx, body }) => {
  const g = owner(rt, req)
  if (!g.ok) return g.res
  const r = await rt.sys.auth.reauth(g.session, body.password, ctx)
  return r.ok ? reply(rt, { body: { ok: true } }) : failure(rt, r)
})

export const forgot = route({ schema: z.object({ username: z.string().max(80) }).strict() }, ({ rt, ctx, body }) => {
  const { response } = rt.sys.auth.forgot(body.username, ctx)
  return response.ok ? reply(rt, { body: response }) : failure(rt, response)
})

export const forgotVerify = route({ schema: z.object({ code: code.optional(), recoveryCode: code.optional() }).strict() }, ({ rt, ctx, body }) => {
  const r = rt.sys.auth.forgotVerify(body, ctx)
  if (!r.ok) return failure(rt, r)
  return reply(rt, { body: { ok: true }, set: [{ kind: 'reset', value: r.resetToken }] })
})

export const forgotReset = route({ schema: z.object({ newPassword: password }).strict() }, async ({ rt, req, ctx, body }) => {
  const r = await rt.sys.auth.forgotReset(readCookie(req, cookieName(rt, 'reset')), body.newPassword, ctx)
  if (!r.ok) return failure(rt, r)
  // nobody is signed in by this: the owner signs in normally, authenticator code included
  return reply(rt, { body: { ok: true }, clear: ['reset', 'sid', 'pend'] })
})

export const changePassword = route({ schema: z.object({ oldPassword: password, totp: code, newPassword: password }).strict() }, async ({ rt, req, ctx, body }) => {
  const g = owner(rt, req)
  if (!g.ok) return g.res
  const r = await rt.sys.auth.changePassword(g.session, body.oldPassword, body.totp, body.newPassword, ctx)
  if (!r.ok) return failure(rt, r)
  return reply(rt, { body: { ok: true }, set: [{ kind: 'sid', value: r.sessionToken }] })
})

export const regenerateRecovery = route({ schema: z.object({ password, totp: code }).strict() }, async ({ rt, req, ctx, body }) => {
  const g = owner(rt, req)
  if (!g.ok) return g.res
  const r = await rt.sys.auth.regenerateRecovery(body.password, body.totp, ctx)
  return r.ok ? reply(rt, { body: r }) : failure(rt, r)
})

export const totpEnrollStart = route({ schema: z.object({ password: password.optional(), totp: code.optional() }).strict() }, async ({ rt, req, ctx, body }) => {
  const g = owner(rt, req, true)
  if (!g.ok) return g.res
  const r = await rt.sys.auth.startTotpEnroll(g.session, body.password ?? null, body.totp ?? null, ctx)
  return r.ok ? reply(rt, { body: r }) : failure(rt, r)
})

export const totpEnrollConfirm = route({ schema: z.object({ code }).strict() }, ({ rt, req, ctx, body }) => {
  const g = owner(rt, req, true)
  if (!g.ok) return g.res
  const r = rt.sys.auth.confirmTotpEnroll(g.session, body.code, ctx)
  return r.ok ? reply(rt, { body: { ok: true } }) : failure(rt, r)
})

export const phoneStart = route({ schema: z.object({ password, totp: code, newPhone: z.string().max(40) }).strict() }, async ({ rt, req, ctx, body }) => {
  const g = owner(rt, req)
  if (!g.ok) return g.res
  const r = await rt.sys.auth.changePhoneStart(g.session, body.password, body.totp, body.newPhone, ctx)
  return r.ok ? reply(rt, { body: r }) : failure(rt, r)
})

export const phoneConfirm = route({ schema: z.object({ code }).strict() }, ({ rt, req, ctx, body }) => {
  const g = owner(rt, req)
  if (!g.ok) return g.res
  const r = rt.sys.auth.changePhoneConfirm(g.session, body.code, ctx)
  return r.ok ? reply(rt, { body: { ok: true } }) : failure(rt, r)
})

export const devices = route({}, ({ rt, req }) => {
  const g = owner(rt, req)
  if (!g.ok) return g.res
  return reply(rt, { body: { ok: true, devices: rt.sys.auth.devices(g.session) } })
})

export const revokeDevice = route({ schema: z.object({ id: z.string().max(20) }).strict() }, ({ rt, req, body }) => {
  const g = owner(rt, req)
  if (!g.ok) return g.res
  const r = rt.sys.auth.revokeDevice(g.session, body.id)
  return r.ok ? reply(rt, { body: { ok: true } }) : failure(rt, r)
})
