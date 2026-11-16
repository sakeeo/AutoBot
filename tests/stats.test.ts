import { describe, it, expect } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { buildDashboard } from '../src/main/stats'

const NOW = new Date(2026, 10, 16, 14, 0, 0).getTime() // local time, Monday 14:00
const HOUR = 3_600_000
const startOfDay = new Date(2026, 10, 16, 0, 0, 0).getTime()

let n = 0
const log = (db: Db, decision: string, at: number): void => {
  db.prepare('INSERT INTO message_log(message_id, chat_id, decision, created_at, text) VALUES (?, ?, ?, ?, ?)')
    .run(`m${++n}`, 'c@s.whatsapp.net', decision, at, 'halo')
}
const event = (db: Db, type: string, at: number): void => {
  db.prepare('INSERT INTO events(chat_id, type, created_at) VALUES (?, ?, ?)').run('c@s.whatsapp.net', type, at)
}
const zero = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }

describe('buildDashboard', () => {
  it('returns zeros and empty lists on an empty database', () => {
    const d = buildDashboard(openDb(':memory:'), NOW)
    expect(d.today).toEqual(zero)
    expect(d.week).toEqual(zero)
    expect(d.waitingAdmin).toBe(0)
    expect(d.recent).toEqual([])
    expect(d.files).toEqual({ indexed: 0, failed: 0 })
  })

  it('classifies decisions by prefix and ignores ignored/pending', () => {
    const db = openDb(':memory:')
    for (const dec of ['replied:ai', 'replied:extractive', 'out_of_context:reply', 'out_of_context:silent',
      'handoff:komplain', 'error:boom', 'ignored:cooldown', 'pending'])
      log(db, dec, NOW - HOUR)
    expect(buildDashboard(db, NOW).today).toEqual({ replied: 2, refused: 2, handoff: 1, errors: 1, links: 0 })
  })

  it('counts yesterday late night in the week but not in today', () => {
    const db = openDb(':memory:')
    log(db, 'replied:ai', startOfDay - 60_000)
    log(db, 'replied:ai', startOfDay + 60_000)
    log(db, 'replied:ai', NOW - 8 * 24 * HOUR)
    const d = buildDashboard(db, NOW)
    expect(d.today.replied).toBe(1)
    expect(d.week.replied).toBe(2)
  })

  it('sums checkout_sent and link_sent events as links', () => {
    const db = openDb(':memory:')
    event(db, 'checkout_sent', NOW - HOUR)
    event(db, 'link_sent', NOW - HOUR)
    event(db, 'handoff', NOW - HOUR)
    event(db, 'link_sent', NOW - 9 * 24 * HOUR)
    const d = buildDashboard(db, NOW)
    expect(d.today.links).toBe(2)
    expect(d.week.links).toBe(2)
  })

  it('counts only chats still waiting for an admin', () => {
    const db = openDb(':memory:')
    const add = (id: string, status: string, until: number | null): void => {
      db.prepare('INSERT INTO contacts(chat_id, status, paused_until) VALUES (?, ?, ?)').run(id, status, until)
    }
    add('a', 'menunggu_admin', NOW + HOUR)
    add('b', 'menunggu_admin', NOW - 1)
    add('c', 'manusia', NOW + HOUR)
    add('d', 'bot', null)
    expect(buildDashboard(db, NOW).waitingAdmin).toBe(1)
  })

  it('lists at most 5 recent log rows, newest first, and counts files', () => {
    const db = openDb(':memory:')
    for (let i = 0; i < 7; i++) log(db, 'replied:ai', NOW - (10 - i) * 1000)
    db.prepare("INSERT INTO files(file, status) VALUES ('a.md','indexed'),('b.md','indexed'),('c.md','failed')").run()
    const d = buildDashboard(db, NOW)
    expect(d.recent).toHaveLength(5)
    expect(d.recent[0].created_at).toBeGreaterThan(d.recent[4].created_at)
    expect(d.recent[0].decision).toBe('replied:ai')
    expect(d.files).toEqual({ indexed: 2, failed: 1 })
  })
})

describe('buildDashboard trend', () => {
  const DAY = 24 * HOUR
  it('has seven local days ending today, oldest first, zero-filled', () => {
    const t = buildDashboard(openDb(':memory:'), NOW).trend
    expect(t).toHaveLength(7)
    expect(t[6].day).toBe('2026-11-16')
    expect(t[0].day).toBe('2026-11-10')
    for (const d of t) expect(d).toMatchObject({ replied: 0, refused: 0, handoff: 0, errors: 0 })
  })
  it('buckets decisions into the day they happened, by local midnight', () => {
    const db = openDb(':memory:')
    log(db, 'replied:ai', startOfDay + 60_000)
    log(db, 'replied:ai', startOfDay - 60_000)
    log(db, 'out_of_context:reply', startOfDay - DAY + 5 * HOUR)
    log(db, 'handoff:komplain', startOfDay - 2 * DAY + HOUR)
    log(db, 'error:boom', startOfDay - 6 * DAY + HOUR)
    log(db, 'ignored:cooldown', NOW - HOUR)
    log(db, 'replied:ai', startOfDay - 7 * DAY - 60_000)
    const t = buildDashboard(db, NOW).trend
    expect(t[6]).toMatchObject({ day: '2026-11-16', replied: 1 })
    expect(t[5]).toMatchObject({ day: '2026-11-15', replied: 1, refused: 1 })
    expect(t[4]).toMatchObject({ handoff: 1 })
    expect(t[0]).toMatchObject({ errors: 1 })
    expect(t.reduce((n, d) => n + d.replied, 0)).toBe(2)
  })
})
