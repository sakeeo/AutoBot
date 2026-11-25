import { SETUP_EVENTS } from '@autobot/contracts/rpc-policy'
import { cookieName, failure, readCookie, route } from '../http'
import { principalOf } from './rpc'

const RECHECK_MS = 15_000

/**
 * Relays the worker's live events to the browser. The browser must be signed in (or be the setup wizard, which only sees
 * the connection state). While the stream is open the session is checked again every few seconds, so signing out, an
 * expired session or a password reset closes the stream instead of leaving it running.
 */
export const events = route({}, async ({ rt, req }) => {
  const p = principalOf(rt, req, false) // an open stream is not activity
  if ('error' in p) return p.error
  const ctl = new AbortController()
  req.signal.addEventListener('abort', () => ctl.abort())
  const up = await rt.worker.events(ctl.signal).catch(() => null)
  if (!up || !up.ok || !up.body) return failure(rt, { ok: false, code: 'WA_UNAVAILABLE', message: 'Server belum siap.' })

  const stillValid = (): boolean =>
    p.who === 'owner'
      ? !!rt.sys.auth.owner(readCookie(req, cookieName(rt, 'sid')), false)
      : !rt.sys.setup.isComplete() && !!rt.sys.sessions.get('setup', readCookie(req, cookieName(rt, 'setup')), false)

  const reader = up.body.getReader()
  const dec = new TextDecoder()
  const enc = new TextEncoder()
  let buf = ''
  const allowed = (block: string): boolean => {
    if (p.who === 'owner' || block.startsWith(':')) return true
    const m = /^event: (.+)$/m.exec(block)
    return !!m && SETUP_EVENTS.has(m[1])
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const timer = setInterval(() => {
        if (!stillValid()) { clearInterval(timer); ctl.abort(); try { controller.close() } catch { /* already closed */ } }
      }, RECHECK_MS)
      ;(async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream: true })
            let i: number
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i)
              buf = buf.slice(i + 2)
              if (allowed(block)) controller.enqueue(enc.encode(`${block}\n\n`))
            }
          }
        } catch { /* upstream or client went away */ } finally {
          clearInterval(timer)
          try { controller.close() } catch { /* already closed */ }
        }
      })()
    },
    cancel() { ctl.abort() }
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' }
  })
})
