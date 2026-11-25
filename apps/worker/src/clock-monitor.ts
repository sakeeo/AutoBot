/**
 * Compares this machine's clock with the `Date` header of a trusted HTTPS endpoint. TOTP (login) fails when the
 * clock drifts by about a step (30 s), and the cause is invisible to the owner, so /health reports it.
 */
export type ClockStatus = 'ok' | 'warn' | 'bad' | 'unknown'
export interface ClockReport { status: ClockStatus; skewMs: number | null; checkedAt: number | null }

export const CLOCK_WARN_MS = 10_000
export const CLOCK_BAD_MS = 25_000

export const classifySkew = (skewMs: number): ClockStatus => {
  const a = Math.abs(skewMs)
  return a >= CLOCK_BAD_MS ? 'bad' : a >= CLOCK_WARN_MS ? 'warn' : 'ok'
}

/** Returns the remote time in ms since epoch, or null when it cannot be read. */
export type TimeProbe = () => Promise<number | null>

export const httpDateProbe = (url = 'https://oauth2.googleapis.com/', fetchImpl: typeof fetch = fetch): TimeProbe =>
  async () => {
    try {
      const res = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      const t = Date.parse(res.headers.get('date') ?? '')
      return Number.isFinite(t) ? t : null
    } catch {
      return null
    }
  }

export class ClockMonitor {
  private report: ClockReport = { status: 'unknown', skewMs: null, checkedAt: null }
  private timer?: ReturnType<typeof setInterval>

  constructor(private probe: TimeProbe, private clock: { now(): number }, private onChange?: (r: ClockReport) => void) {}

  current(): ClockReport { return this.report }

  async check(): Promise<ClockReport> {
    const t0 = this.clock.now()
    const remote = await this.probe()
    const t1 = this.clock.now()
    if (remote == null) {
      // Keep the last known skew; only say "unknown" if we never had one.
      this.report = { ...this.report, checkedAt: t1 }
    } else {
      // Date has 1 s resolution: subtract the half-second of truncation and the half round trip.
      const skewMs = Math.round(t0 + (t1 - t0) / 2 - (remote + 500))
      this.report = { status: classifySkew(skewMs), skewMs, checkedAt: t1 }
    }
    this.onChange?.(this.report)
    return this.report
  }

  start(everyMs = 6 * 60 * 60 * 1000): void {
    void this.check()
    this.timer = setInterval(() => void this.check(), everyMs)
    this.timer.unref?.()
  }

  stop(): void { if (this.timer) clearInterval(this.timer) }
}
