import { z } from 'zod'
import { CHANNELS } from '../../shared/channels'
import { AuthSetupSchema, type AuthResult, type AuthState } from '../../shared/ipc'
import type { AuthStore } from './auth-store'

export const AUTH_CHANNELS: ReadonlySet<string> = new Set(
  Object.values(CHANNELS).filter((c) => c.startsWith('auth:'))
)

/** Wraps an IPC handler so it refuses to run while the app is locked, unless it is an auth channel. */
export function guardHandler<A extends unknown[], R>(
  isLocked: () => boolean,
  allowed: boolean,
  fn: (...a: A) => R
): (...a: A) => R {
  return (...a: A): R => {
    if (!allowed && isLocked()) throw new Error('LOCKED')
    return fn(...a)
  }
}

const Text = z.string().max(200)
const Minutes = z.number().finite()

export interface AuthHandlers {
  isLocked(): boolean
  lock(): void
  authState(): AuthState
  authLogin(username: unknown, password: unknown): AuthResult
  authLock(): void
  authSetup(username: unknown, password: unknown): { ok: true; recoveryCode: string } | { ok: false; error: 'invalid' }
  authChangePassword(oldPassword: unknown, newPassword: unknown): AuthResult
  authReset(code: unknown, newPassword: unknown): AuthResult & { recoveryCode?: string }
  authDisable(password: unknown): AuthResult
  authSetAutoLock(min: unknown): void
}

export function createAuthHandlers(auth: AuthStore): AuthHandlers {
  let locked = auth.isEnabled()
  const bad = { ok: false, error: 'bad' } as const
  const invalid = { ok: false, error: 'invalid' } as const
  const verdict = (c: 'ok' | 'bad' | 'throttled'): AuthResult => (c === 'ok' ? { ok: true } : { ok: false, error: c })
  const attempt = (f: () => AuthResult): AuthResult => {
    try { return f() } catch (e) {
      if ((e as Error).message === 'INVALID_INPUT') return invalid
      throw e
    }
  }

  return {
    isLocked: () => locked,
    lock: () => { if (auth.isEnabled()) locked = true },
    authState: () => ({ enabled: auth.isEnabled(), locked, username: auth.username(), autoLockMin: auth.autoLockMin() }),
    authLock() { this.lock() },

    authLogin(u, p) {
      const a = Text.safeParse(u), b = Text.safeParse(p)
      if (!a.success || !b.success) return bad
      const r = verdict(auth.verify(a.data, b.data))
      if (r.ok) locked = false
      return r
    },
    authSetup(u, p) {
      const parsed = AuthSetupSchema.safeParse({ username: u, password: p })
      if (!parsed.success || locked) return invalid
      try {
        const { recoveryCode } = auth.setup(parsed.data.username, parsed.data.password)
        locked = false
        return { ok: true, recoveryCode }
      } catch {
        return invalid
      }
    },
    authChangePassword(o, n) {
      const a = Text.safeParse(o), b = Text.safeParse(n)
      if (locked || !a.success || !b.success) return bad
      return attempt(() => verdict(auth.changePassword(a.data, b.data)))
    },
    // Allowed while locked: it is the lock screen's way back in.
    authReset(c, n) {
      const a = Text.safeParse(c), b = Text.safeParse(n)
      if (!a.success || !b.success) return bad
      try {
        const r = auth.reset(a.data, b.data)
        return typeof r === 'object' ? { ok: true, recoveryCode: r.recoveryCode } : verdict(r)
      } catch (e) {
        if ((e as Error).message === 'INVALID_INPUT') return invalid
        throw e
      }
    },
    authDisable(p) {
      const a = Text.safeParse(p)
      if (locked || !a.success) return bad
      const r = verdict(auth.disable(a.data))
      if (r.ok) locked = false
      return r
    },
    authSetAutoLock(m) {
      if (locked) throw new Error('LOCKED')
      auth.setAutoLockMin(Minutes.parse(m))
    }
  }
}
