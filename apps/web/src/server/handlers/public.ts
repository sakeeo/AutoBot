import { reply, route } from '../http'

/** What the login page needs to know before anyone is signed in: whether setup is finished, and whether WhatsApp is up. */
export const authStatus = route({}, async ({ rt }) => {
  const h = await rt.worker.health()
  return reply(rt, { body: { ok: true, setupComplete: rt.sys.setup.isComplete(), waConnected: h?.wa === 'connected' } })
})

/** Liveness for Docker: the web app itself is up; the worker is reported, not required. */
export const health = route({}, async ({ rt }) => {
  const h = await rt.worker.health()
  return reply(rt, { body: { ok: true, setupComplete: rt.sys.setup.isComplete(), worker: h ? { ok: h.ok, wa: h.wa, botEnabled: h.botEnabled, clock: h.clock ?? null } : null } })
})
