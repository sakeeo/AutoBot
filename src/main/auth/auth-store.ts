import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const MIN_PASSWORD = 8
const MAX_FAILS = 5
const BLOCK_MS = 30_000

interface Secret { salt: string; hash: string }
interface AuthFile {
  username: string
  password: Secret
  recovery: Secret
  autoLockMin: number
}
type Check = 'ok' | 'bad' | 'throttled'

const derive = (value: string, salt: Buffer): Buffer => scryptSync(value.normalize('NFKC'), salt, 32, { N: 16384 })

function makeSecret(value: string): Secret {
  const salt = randomBytes(16)
  return { salt: salt.toString('hex'), hash: derive(value, salt).toString('hex') }
}

function matches(value: string, s: Secret): boolean {
  const expected = Buffer.from(s.hash, 'hex')
  const actual = derive(value, Buffer.from(s.salt, 'hex'))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const normalizeCode = (c: string): string => c.replace(/[^0-9a-f]/gi, '').toUpperCase()

function newRecoveryCode(): string {
  return randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')
}

function checkPassword(p: string): void {
  if (p.length < MIN_PASSWORD) throw new Error('INVALID_INPUT')
}

/** Login credentials for the app UI. A lock for the screen, not encryption of data at rest. */
export class AuthStore {
  private data: AuthFile | null
  private fails = 0
  private blockedUntil = 0

  constructor(private file: string, private clock: { now(): number }) {
    this.data = this.load()
  }

  private load(): AuthFile | null {
    if (!existsSync(this.file)) return null
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as AuthFile
      if (typeof d.username !== 'string' || !d.password?.hash || !d.recovery?.hash) return null
      return { ...d, autoLockMin: Number.isFinite(d.autoLockMin) ? d.autoLockMin : 0 }
    } catch {
      return null
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 })
  }

  /** Counts every attempt against one shared limit so no endpoint can be used to guess faster. */
  private attempt(ok: () => boolean): Check {
    if (this.clock.now() < this.blockedUntil) return 'throttled'
    if (ok()) {
      this.fails = 0
      return 'ok'
    }
    if (++this.fails >= MAX_FAILS) {
      this.fails = 0
      this.blockedUntil = this.clock.now() + BLOCK_MS
    }
    return 'bad'
  }

  isEnabled(): boolean { return this.data !== null }
  username(): string | null { return this.data?.username ?? null }
  autoLockMin(): number { return this.data?.autoLockMin ?? 0 }

  setup(username: string, password: string): { recoveryCode: string } {
    if (this.data) throw new Error('ALREADY_ENABLED')
    const name = username.trim()
    if (!name || name.length > 40) throw new Error('INVALID_INPUT')
    checkPassword(password)
    const recoveryCode = newRecoveryCode()
    this.data = { username: name, password: makeSecret(password), recovery: makeSecret(normalizeCode(recoveryCode)), autoLockMin: 0 }
    this.save()
    return { recoveryCode }
  }

  verify(username: string, password: string): Check {
    const d = this.data
    if (!d) return 'bad'
    return this.attempt(() => {
      // Evaluate both so timing does not reveal whether the username was right.
      const passOk = matches(password, d.password)
      return passOk && username.trim().toLowerCase() === d.username.toLowerCase()
    })
  }

  changePassword(oldPassword: string, newPassword: string): Check {
    const d = this.data
    if (!d) return 'bad'
    checkPassword(newPassword)
    const r = this.attempt(() => matches(oldPassword, d.password))
    if (r === 'ok') {
      d.password = makeSecret(newPassword)
      this.save()
    }
    return r
  }

  reset(recoveryCode: string, newPassword: string): { recoveryCode: string } | 'bad' | 'throttled' {
    const d = this.data
    if (!d) return 'bad'
    checkPassword(newPassword)
    const r = this.attempt(() => matches(normalizeCode(recoveryCode), d.recovery))
    if (r !== 'ok') return r
    const next = newRecoveryCode()
    d.password = makeSecret(newPassword)
    d.recovery = makeSecret(normalizeCode(next))
    this.save()
    return { recoveryCode: next }
  }

  disable(password: string): Check {
    const d = this.data
    if (!d) return 'bad'
    const r = this.attempt(() => matches(password, d.password))
    if (r === 'ok') {
      this.data = null
      rmSync(this.file, { force: true })
    }
    return r
  }

  setAutoLockMin(min: number): void {
    if (!this.data) return
    this.data.autoLockMin = Math.min(240, Math.max(0, Math.round(min)))
    this.save()
  }
}
