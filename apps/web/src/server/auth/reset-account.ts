import type { AuthDb } from './db'

/**
 * Server-side account reset: removes the owner account and everything tied to it (password, authenticator, recovery
 * codes, sessions, pending codes, throttles), so the setup wizard opens again at the next start of the panel.
 * The worker's data (WhatsApp session, knowledge, settings, conversations) is not touched: it lives in another database.
 * The audit log is kept, with one entry for the reset.
 */
export function resetAccount(db: AuthDb, now: number): { hadAccount: boolean } {
  return db.transaction(() => {
    const u = db.prepare('SELECT username FROM users WHERE id = 1').get() as { username: string } | undefined
    for (const t of ['users', 'recovery_codes', 'sessions', 'setup_state', 'otp_challenges', 'otp_failures', 'throttle', 'rate_windows'])
      db.prepare(`DELETE FROM ${t}`).run()
    db.prepare("INSERT INTO audit_log(at, action, actor, via, ip_hash, detail) VALUES (?, 'account_reset', ?, 'server', NULL, NULL)")
      .run(now, u?.username ?? 'system')
    return { hadAccount: !!u }
  })()
}
