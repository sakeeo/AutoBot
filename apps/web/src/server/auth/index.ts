import type { AuthDb } from './db'
import { Keys } from './crypto'
import { Audit } from './audit'
import { AuthService } from './auth'
import { OtpService } from './otp'
import { RecoveryCodes } from './recovery'
import { Sessions, DEFAULT_POLICY, type SessionPolicy } from './sessions'
import { SetupService } from './setup'
import { RateWindow, Throttle, type Clock } from './throttle'
import type { WorkerPort } from './types'

export interface AuthSystem {
  db: AuthDb
  keys: Keys
  clock: Clock
  sessions: Sessions
  throttle: Throttle
  rate: RateWindow
  otp: OtpService
  recovery: RecoveryCodes
  audit: Audit
  setup: SetupService
  auth: AuthService
}

/** Wires every part of the login system over one database and one deployment secret. */
export function createAuthSystem(o: { db: AuthDb; secretKey: Buffer; worker: WorkerPort; clock?: Clock; policy?: SessionPolicy }): AuthSystem {
  const clock = o.clock ?? { now: () => Date.now() }
  const keys = new Keys(o.secretKey)
  const sessions = new Sessions(o.db, keys, clock, o.policy ?? DEFAULT_POLICY)
  const throttle = new Throttle(o.db, clock)
  const rate = new RateWindow(o.db, clock)
  const otp = new OtpService(o.db, keys, clock)
  const recovery = new RecoveryCodes(o.db, keys, clock)
  const audit = new Audit(o.db, clock)
  const deps = { db: o.db, keys, clock, sessions, throttle, rate, otp, recovery, audit, worker: o.worker }
  return { db: o.db, keys, clock, sessions, throttle, rate, otp, recovery, audit, setup: new SetupService(deps), auth: new AuthService(deps) }
}
