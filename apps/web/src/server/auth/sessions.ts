import { randomBytes } from 'node:crypto'
import type { AuthDb } from './db'
import { sha256, type Keys } from './crypto'
import type { Clock } from './throttle'

export type SessionKind = 'owner' | 'setup' | 'pending' | 'reset'

const MIN = 60_000
const HOUR = 60 * MIN

export interface SessionPolicy {
  ownerIdleMs: number
  ownerAbsoluteMs: number
}
export const DEFAULT_POLICY: SessionPolicy = { ownerIdleMs: 30 * MIN, ownerAbsoluteMs: 12 * HOUR }

const LIMITS: Record<Exclude<SessionKind, 'owner'>, { idleMs: number; absoluteMs: number }> = {
  setup: { idleMs: 30 * MIN, absoluteMs: 4 * HOUR },
  pending: { idleMs: 5 * MIN, absoluteMs: 5 * MIN },
  reset: { idleMs: 10 * MIN, absoluteMs: 10 * MIN }
}

export interface Session {
  idHash: string
  kind: SessionKind
  createdAt: number
  lastSeenAt: number
  expiresAt: number
  reauthAt: number | null
  restricted: boolean
  data: Record<string, unknown> | null
  userAgent: string | null
}

interface Row {
  id_hash: string; kind: SessionKind; created_at: number; last_seen_at: number; expires_at: number
  reauth_at: number | null; restricted: number; data_enc: string | null; user_agent: string | null
}

/**
 * Server-side sessions. The browser holds a random 256-bit token; only its SHA-256 is stored, so a copy of the database
 * cannot be turned into a signed-in browser. A session ends when it has been idle too long or has lived too long,
 * whichever comes first.
 */
export class Sessions {
  constructor(private db: AuthDb, private keys: Keys, private clock: Clock, private policy: SessionPolicy = DEFAULT_POLICY) {}

  create(kind: SessionKind, o: { ipHash?: string | null; userAgent?: string | null; restricted?: boolean; data?: Record<string, unknown> } = {}): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url')
    const now = this.clock.now()
    const absolute = kind === 'owner' ? this.policy.ownerAbsoluteMs : LIMITS[kind].absoluteMs
    const sealed = o.data ? this.keys.seal('setup-token', 'session-data', JSON.stringify(o.data)) : null
    this.db
      .prepare('INSERT INTO sessions(id_hash, kind, created_at, last_seen_at, expires_at, restricted, data_enc, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(token), kind, now, now, now + absolute, o.restricted ? 1 : 0, sealed, o.ipHash ?? null, (o.userAgent ?? '').slice(0, 200) || null)
    return { token, expiresAt: now + absolute }
  }

  /**
   * The live session behind a token of the expected kind, or null. Counts as activity (moves `last_seen`, at most once a
   * minute) unless `touch` is false, which background polling uses so an open tab does not keep a session alive forever.
   */
  get(kind: SessionKind, token: string | undefined | null, touch = true): Session | null {
    if (!token || token.length > 100) return null
    const row = this.db.prepare('SELECT * FROM sessions WHERE id_hash = ? AND kind = ?').get(sha256(token), kind) as Row | undefined
    if (!row) return null
    const now = this.clock.now()
    const idle = kind === 'owner' ? this.policy.ownerIdleMs : LIMITS[kind].idleMs
    if (row.expires_at <= now || now - row.last_seen_at >= idle) {
      this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(row.id_hash)
      return null
    }
    if (touch && now - row.last_seen_at >= MIN) this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(now, row.id_hash)
    let data: Record<string, unknown> | null = null
    if (row.data_enc) {
      const plain = this.keys.open('setup-token', 'session-data', row.data_enc)
      data = plain ? (JSON.parse(plain) as Record<string, unknown>) : null
    }
    return {
      idHash: row.id_hash, kind: row.kind, createdAt: row.created_at, lastSeenAt: now, expiresAt: row.expires_at,
      reauthAt: row.reauth_at, restricted: row.restricted === 1, data, userAgent: row.user_agent
    }
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token))
  }
  revokeKind(kind: SessionKind, exceptIdHash?: string): void {
    this.db.prepare('DELETE FROM sessions WHERE kind = ? AND id_hash != ?').run(kind, exceptIdHash ?? '')
  }
  revokeAll(): void {
    this.db.prepare('DELETE FROM sessions').run()
  }
  /** Revokes one owner session by the short id the "active devices" list shows. */
  revokeByShortId(shortId: string, exceptIdHash?: string): boolean {
    if (!/^[0-9a-f]{12}$/.test(shortId)) return false
    return this.db.prepare("DELETE FROM sessions WHERE kind = 'owner' AND id_hash LIKE ? AND id_hash != ?").run(`${shortId}%`, exceptIdHash ?? '').changes > 0
  }
  /** Replaces the sealed data of the step in progress. */
  setData(idHash: string, data: Record<string, unknown> | null): void {
    this.db.prepare('UPDATE sessions SET data_enc = ? WHERE id_hash = ?').run(data ? this.keys.seal('setup-token', 'session-data', JSON.stringify(data)) : null, idHash)
  }
  markReauth(idHash: string): void {
    this.db.prepare('UPDATE sessions SET reauth_at = ? WHERE id_hash = ?').run(this.clock.now(), idHash)
  }
  setRestricted(idHash: string, restricted: boolean): void {
    this.db.prepare('UPDATE sessions SET restricted = ? WHERE id_hash = ?').run(restricted ? 1 : 0, idHash)
  }
  listOwner(): { id: string; createdAt: number; lastSeenAt: number; userAgent: string | null; idHash: string }[] {
    const now = this.clock.now()
    return (this.db.prepare("SELECT id_hash, created_at, last_seen_at, user_agent FROM sessions WHERE kind = 'owner' AND expires_at > ? ORDER BY last_seen_at DESC").all(now) as Row[])
      .map((r) => ({ id: r.id_hash.slice(0, 12), idHash: r.id_hash, createdAt: r.created_at, lastSeenAt: r.last_seen_at, userAgent: r.user_agent }))
  }
  purgeExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.clock.now())
  }
}
