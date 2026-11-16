import type { Tier } from '../../shared/broadcast'

/** Hard limits per number age (spec §8). Settings may go below these, never above. */
export const TIER_LIMITS: Record<Tier, { daily: number; newContacts: number }> = {
  baru: { daily: 20, newContacts: 5 },
  berkembang: { daily: 80, newContacts: 15 },
  mapan: { daily: 200, newContacts: 30 }
}
export const HOURLY_MAX = 15
export const BATCH_SIZE = 10

const DAY_MS = 86_400_000

/** The age is declared once; the tier then grows by itself as days pass and never drops. */
export function effectiveTier(declared: { ageDays: number; declaredAt: number }, now: number): Tier {
  const elapsed = Math.max(0, Math.floor((now - declared.declaredAt) / DAY_MS))
  const age = declared.ageDays + elapsed
  return age < 30 ? 'baru' : age < 90 ? 'berkembang' : 'mapan'
}

/** Day 1 sends at most 10; each further active day allows 25% more. */
export function warmupCap(activeDay: number): number {
  return Math.floor(10 * Math.pow(1.25, Math.max(1, activeDay) - 1))
}

export const dailyCap = (tier: Tier, activeDay: number): number => Math.min(TIER_LIMITS[tier].daily, warmupCap(activeDay))

/**
 * Which active day today is: the length of the current run of days with sends (a gap of more than 14 days
 * starts the warm-up over). `sendDays` are 'YYYY-MM-DD' days on which something was sent.
 */
export function activeDayIndex(sendDays: string[], today: string): number {
  const days = [...new Set(sendDays)].sort()
  const t = (d: string): number => Date.parse(`${d}T00:00:00Z`)
  let streak = 0
  let prev: number | null = null
  for (const d of days) {
    if (prev !== null && (t(d) - prev) / DAY_MS > 14) streak = 0
    streak++
    prev = t(d)
  }
  if (prev === null || (t(today) - prev) / DAY_MS > 14) return 1
  return days.includes(today) ? streak : streak + 1
}

export const nextDelayMs = (rand: () => number): number => 20_000 + Math.floor(rand() * 40_000)
export const batchPauseMs = (rand: () => number): number => 180_000 + Math.floor(rand() * 300_000)

export interface Window { start: string; end: string; timezone: string }

function zoned(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; offset: number } {
  const parts = (tz: string): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(ms))
  let p: Intl.DateTimeFormatPart[]
  try {
    p = parts(timeZone)
  } catch {
    p = parts('UTC')
  }
  const n = (t: string): number => Number(p.find((x) => x.type === t)?.value)
  const y = n('year'), mo = n('month'), d = n('day'), h = n('hour') % 24, mi = n('minute')
  return { y, mo, d, h, mi, offset: Date.UTC(y, mo - 1, d, h, mi) - Math.floor(ms / 60_000) * 60_000 }
}
const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function inSendWindow(now: number, w: Window): boolean {
  const z = zoned(now, w.timezone)
  const m = z.h * 60 + z.mi
  return m >= minutesOf(w.start) && m < minutesOf(w.end)
}

/** Now if the window is open, otherwise the next time it opens (today if before it opens, else tomorrow). */
export function nextWindowStart(now: number, w: Window): number {
  const z = zoned(now, w.timezone)
  const m = z.h * 60 + z.mi
  if (m >= minutesOf(w.start) && m < minutesOf(w.end)) return now
  const dayShift = m < minutesOf(w.start) ? 0 : 1
  const s = minutesOf(w.start)
  return Date.UTC(z.y, z.mo - 1, z.d + dayShift, Math.floor(s / 60), s % 60) - z.offset
}

/** Opening of the send window on the day after `now` (in the window's zone). */
export function nextDayWindowStart(now: number, w: Window): number {
  const z = zoned(now, w.timezone)
  const s = minutesOf(w.start)
  return Date.UTC(z.y, z.mo - 1, z.d + 1, Math.floor(s / 60), s % 60) - z.offset
}

/** 'YYYY-MM-DD' of `ms` in the given zone. */
export function localDay(ms: number, timezone: string): string {
  const z = zoned(ms, timezone)
  return `${z.y}-${String(z.mo).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`
}

/** Midnight (start of the local day) of `ms` in the given zone, as a timestamp. */
export function startOfLocalDay(ms: number, timezone: string): number {
  const z = zoned(ms, timezone)
  return Date.UTC(z.y, z.mo - 1, z.d) - z.offset
}
