import type { AuthDb } from './db'
import type { Clock } from './throttle'

/** Who did what, when. Never a password, a code, a token or a message text. */
export class Audit {
  constructor(private db: AuthDb, private clock: Clock) {}

  log(action: string, o: { actor?: string; via?: 'web' | 'server'; ipHash?: string | null; detail?: Record<string, unknown> } = {}): void {
    this.db
      .prepare('INSERT INTO audit_log(at, action, actor, via, ip_hash, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.clock.now(), action, o.actor ?? 'system', o.via ?? 'web', o.ipHash ?? null, o.detail ? JSON.stringify(o.detail) : null)
  }

  recent(limit = 100): { at: number; action: string; actor: string; via: string; detail: string | null }[] {
    return this.db.prepare('SELECT at, action, actor, via, detail FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as never
  }
}
