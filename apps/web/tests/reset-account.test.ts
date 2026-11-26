import { describe, it, expect } from 'vitest'
import { resetAccount } from '../src/server/auth/reset-account'
import { createOwner, ctx, makeEnv } from './helpers'

describe('server account reset', () => {
  it('removes the account, its sessions and recovery codes, and opens setup again; the audit log keeps a record', async () => {
    const env = makeEnv()
    const owner = await createOwner(env)
    expect(env.sys.setup.isComplete()).toBe(true)
    env.db.prepare("INSERT INTO throttle(key, failures, blocked_until, updated_at) VALUES ('login:acct', 9, 9e15, 1)").run()

    expect(resetAccount(env.db, env.clock.now())).toEqual({ hadAccount: true })

    expect(env.sys.setup.isComplete()).toBe(false)
    for (const t of ['users', 'recovery_codes', 'sessions', 'setup_state', 'otp_challenges', 'throttle', 'rate_windows'])
      expect((env.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n, t).toBe(0)
    expect(env.sys.auth.owner(owner.sessionToken)).toBeNull() // the old session no longer works
    const last = env.db.prepare('SELECT action, actor, via FROM audit_log ORDER BY id DESC LIMIT 1').get()
    expect(last).toEqual({ action: 'account_reset', actor: owner.username, via: 'server' })
    expect((env.db.prepare('SELECT COUNT(*) n FROM audit_log').get() as { n: number }).n).toBeGreaterThan(1)
  })

  it('lets a new account be made through the wizard afterwards, with a new username', async () => {
    const env = makeEnv()
    await createOwner(env, { username: 'budi' })
    resetAccount(env.db, env.clock.now())
    const again = await createOwner(env, { username: 'sari' })
    expect(again.username).toBe('sari')
    const login = await env.sys.auth.login('sari', again.password, ctx())
    expect(login.ok).toBe(true)
    expect((await env.sys.auth.login('budi', again.password, ctx())).ok).toBe(false)
  })

  it('is safe to run when there is no account yet', () => {
    const env = makeEnv()
    expect(resetAccount(env.db, env.clock.now())).toEqual({ hadAccount: false })
    expect(env.sys.setup.isComplete()).toBe(false)
  })
})
