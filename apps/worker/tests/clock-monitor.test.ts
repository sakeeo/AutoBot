import { describe, expect, it } from 'vitest'
import { ClockMonitor, classifySkew } from '../src/clock-monitor'

const fixed = (t: number) => ({ now: () => t })

describe('ClockMonitor', () => {
  it('classifies skew against the TOTP step', () => {
    expect(classifySkew(2_000)).toBe('ok')
    expect(classifySkew(-12_000)).toBe('warn')
    expect(classifySkew(26_000)).toBe('bad')
  })
  it('is unknown until a probe succeeds, then reports skew (local minus remote)', async () => {
    const now = 1_000_000_000_000
    const m = new ClockMonitor(async () => null, fixed(now))
    expect((await m.check()).status).toBe('unknown')
    // remote Date header is truncated to the second: a remote clock 30 s behind
    const m2 = new ClockMonitor(async () => now - 30_500, fixed(now))
    const r = await m2.check()
    expect(r.status).toBe('bad')
    expect(r.skewMs).toBe(30_000)
  })
  it('keeps the last known skew when a later probe fails', async () => {
    let remote: number | null = 1_000_000_000_000
    const m = new ClockMonitor(async () => remote, fixed(1_000_000_000_500))
    await m.check()
    remote = null
    const r = await m.check()
    expect(r.status).toBe('ok')
  })
})
