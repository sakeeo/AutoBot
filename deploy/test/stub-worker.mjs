// TEST ONLY. A stand-in for the worker so the web image can be driven end to end without WhatsApp.
// It answers the internal API the web app uses and prints each verification code, so the test can read it.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'

const token = readFileSync('/run/secrets/worker_token', 'utf8').trim()
const ok = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)) })
const authorised = (req) => {
  const g = Buffer.from(String(req.headers['x-worker-token'] ?? '')), t = Buffer.from(token)
  return g.length === t.length && timingSafeEqual(g, t)
}
const DATA = { getStatus: { state: 'connected' }, getSelfNumber: '628110009999', getBotEnabled: false }

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (req.method === 'GET' && path === '/health') return ok(res, { ok: true, wa: 'connected', botEnabled: false })
  if (!authorised(req)) return ok(res, { ok: false, code: 'UNAUTHENTICATED', message: 'Tidak diizinkan.' }, 401)
  if (path.startsWith('/rpc/')) {
    await readBody(req)
    const m = decodeURIComponent(path.slice(5))
    return ok(res, { ok: true, data: m in DATA ? DATA[m] : null })
  }
  if (path === '/system-send') {
    const b = JSON.parse((await readBody(req)) || '{}')
    console.log(`[stub] system-send kind=${b.kind}${b.code ? ` code=${b.code}` : ''}`)
    return ok(res, { ok: true })
  }
  if (path === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const send = () => res.write(`event: evt:status\ndata: ${JSON.stringify({ state: 'connected' })}\n\n`)
    send()
    const t = setInterval(send, 2000)
    req.on('close', () => clearInterval(t))
    return
  }
  ok(res, { ok: false, code: 'NOT_FOUND', message: 'tidak ada' }, 404)
}).listen(4000, '0.0.0.0', () => console.log('[stub] listening'))
