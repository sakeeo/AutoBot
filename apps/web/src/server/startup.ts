import { getRuntime } from './runtime'

/** Runs once when the server starts (see instrumentation.ts). Fails fast on a bad configuration. */
export async function startup(): Promise<void> {
  const rt = getRuntime()
  const token = rt.sys.setup.ensureToken()
  if (token) {
    const url = new URL('/setup', rt.config.appUrl).toString()
    // The token goes to the server log only (never to the browser): whoever can read the log owns the setup.
    console.log(`\n==================== AutoBot: setup belum selesai ====================\nBuka ${url}\nToken setup (berlaku sampai server dimulai ulang):\n\n  ${token}\n\n=======================================================================\n`)
  }
  const timer = setInterval(() => { try { rt.sys.sessions.purgeExpired() } catch { /* the next tick tries again */ } }, 10 * 60_000)
  timer.unref()
}
