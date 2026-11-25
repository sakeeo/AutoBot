import type { AuthDb } from './db'

export interface Clock { now(): number }

const DAY_MS = 86_400_000

/**
 * Slows down guessing without ever locking the owner out for good. After five failures in a row the key waits a minute,
 * and every further failure doubles the wait, up to an hour. A success clears it. Failures older than a day are forgotten.
 * The counters live in the database, so a restart does not reset them.
 */
export class Throttle {
  constructor(private db: AuthDb, private clock: Clock) {}

  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const row = this.db.prepare('SELECT blocked_until FROM throttle WHERE key = ?').get(key) as { blocked_until: number } | undefined
    const wait = row ? row.blocked_until - this.clock.now() : 0
    return wait > 0 ? { allowed: false, retryAfterSec: Math.ceil(wait / 1000) } : { allowed: true, retryAfterSec: 0 }
  }

  fail(key: string): void {
    const now = this.clock.now()
    const row = this.db.prepare('SELECT failures, updated_at FROM throttle WHERE key = ?').get(key) as { failures: number; updated_at: number } | undefined
    const failures = (row && now - row.updated_at < DAY_MS ? row.failures : 0) + 1
    const blockedUntil = failures >= 5 ? now + Math.min(3600, 60 * 2 ** (failures - 5)) * 1000 : 0
    this.db
      .prepare(
        `INSERT INTO throttle(key, failures, blocked_until, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, blocked_until = excluded.blocked_until, updated_at = excluded.updated_at`
      )
      .run(key, failures, blockedUntil, now)
  }

  reset(key: string): void {
    this.db.prepare('DELETE FROM throttle WHERE key = ?').run(key)
  }
}

/** A plain fixed-window counter for things that are limited per period rather than per failure (e.g. token entries). */
export class RateWindow {
  constructor(private db: AuthDb, private clock: Clock) {}

  /** Counts one use of `key`; returns false when the limit for the current window has been reached. */
  consume(key: string, max: number, windowMs: number): boolean {
    const now = this.clock.now()
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT window_start, count FROM rate_windows WHERE key = ?').get(key) as { window_start: number; count: number } | undefined
      if (!row || now - row.window_start >= windowMs) {
        this.db.prepare('INSERT INTO rate_windows(key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1').run(key, now)
        return true
      }
      if (row.count >= max) return false
      this.db.prepare('UPDATE rate_windows SET count = count + 1 WHERE key = ?').run(key)
      return true
    })()
  }
}
