import { describe, it, expect } from 'vitest'
import {
  BATCH_SIZE, HOURLY_MAX, TIER_LIMITS, activeDayIndex, batchPauseMs, dailyCap, effectiveTier, inSendWindow,
  nextDelayMs, nextWindowStart, warmupCap
} from '../../src/main/broadcast/limits'

const DAY = 86_400_000
const W = { start: '09:00', end: '20:00', timezone: 'Asia/Makassar' }
// 2026-11-16 is a Monday; Asia/Makassar is UTC+8.
const at = (h: number, m = 0, day = 16) => Date.UTC(2026, 10, day, h - 8, m)

describe('tiers and caps', () => {
  it('matches the table in the spec', () => {
    expect(TIER_LIMITS).toEqual({
      baru: { daily: 20, newContacts: 5 },
      berkembang: { daily: 80, newContacts: 15 },
      mapan: { daily: 200, newContacts: 30 }
    })
    expect(HOURLY_MAX).toBe(15)
    expect(BATCH_SIZE).toBe(10)
  })
  it('lets the effective tier grow with time but never drop', () => {
    const now = Date.UTC(2026, 10, 1)
    expect(effectiveTier({ ageDays: 25, declaredAt: now }, now)).toBe('baru')
    expect(effectiveTier({ ageDays: 25, declaredAt: now }, now + 6 * DAY)).toBe('berkembang')
    expect(effectiveTier({ ageDays: 60, declaredAt: now }, now + 31 * DAY)).toBe('mapan')
    expect(effectiveTier({ ageDays: 200, declaredAt: now }, now)).toBe('mapan')
    expect(effectiveTier({ ageDays: 0, declaredAt: now }, now - 5 * DAY)).toBe('baru')
  })
  it('warms up from 10 and grows 25% a day', () => {
    expect([1, 2, 3, 4].map(warmupCap)).toEqual([10, 12, 15, 19])
  })
  it('never lets the daily cap pass the tier limit, even for a mature account on day one', () => {
    expect(dailyCap('baru', 30)).toBe(20)
    expect(dailyCap('mapan', 1)).toBe(10)
    expect(dailyCap('mapan', 30)).toBe(200)
    expect(dailyCap('berkembang', 8)).toBeLessThanOrEqual(80)
  })
})

describe('activeDayIndex', () => {
  it('counts consecutive active days and starts over after a gap over 14 days', () => {
    expect(activeDayIndex([], '2026-11-16')).toBe(1)
    expect(activeDayIndex(['2026-11-14', '2026-11-15'], '2026-11-16')).toBe(3)
    expect(activeDayIndex(['2026-11-14', '2026-11-15'], '2026-11-15')).toBe(2)
    expect(activeDayIndex(['2026-10-01'], '2026-10-21')).toBe(1)
    expect(activeDayIndex(['2026-10-01', '2026-10-21'], '2026-10-21')).toBe(1)
    expect(activeDayIndex(['2026-10-01', '2026-10-12'], '2026-10-13')).toBe(3)
  })
})

describe('pacing', () => {
  it('keeps the delay between messages inside 20–60 s and the batch pause inside 3–8 min', () => {
    expect(nextDelayMs(() => 0)).toBe(20_000)
    expect(nextDelayMs(() => 0.9999999)).toBeLessThan(60_000)
    expect(batchPauseMs(() => 0)).toBe(180_000)
    expect(batchPauseMs(() => 0.9999999)).toBeLessThan(480_000)
    for (let i = 0; i < 50; i++) {
      const d = nextDelayMs(Math.random)
      expect(d).toBeGreaterThanOrEqual(20_000)
      expect(d).toBeLessThan(60_000)
    }
  })
})

describe('send window', () => {
  it('is open from 09:00 up to but not including 20:00 in the given zone', () => {
    expect(inSendWindow(at(9), W)).toBe(true)
    expect(inSendWindow(at(8, 59), W)).toBe(false)
    expect(inSendWindow(at(19, 59), W)).toBe(true)
    expect(inSendWindow(at(20), W)).toBe(false)
  })
  it('points to the next opening: today before it opens, now while open, tomorrow after it closes', () => {
    expect(nextWindowStart(at(7), W)).toBe(at(9))
    expect(nextWindowStart(at(12), W)).toBe(at(12))
    expect(nextWindowStart(at(20, 30), W)).toBe(at(9, 0, 17))
  })
})
