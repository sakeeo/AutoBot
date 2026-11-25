import { randomInt } from 'node:crypto'
import type { AuthDb } from './db'
import type { Keys } from './crypto'
import type { Clock } from './throttle'

// 32 symbols without 0/O/1/I/L, so a code read off paper cannot be mistyped; 10 symbols are 50 bits.
const SYMBOLS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const RECOVERY_COUNT = 10
export const RECOVERY_WARN_AT = 3

const normalise = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

function newCode(): string {
  let s = ''
  for (let i = 0; i < 10; i++) s += SYMBOLS[randomInt(SYMBOLS.length)]
  return s
}
const pretty = (c: string): string => `${c.slice(0, 5)}-${c.slice(5)}`

export class RecoveryCodes {
  constructor(private db: AuthDb, private keys: Keys, private clock: Clock) {}

  private hmac(code: string): string {
    return this.keys.hmac('recovery', normalise(code))
  }

  /** Ten new codes: `shown` is what the person sees once, `hmacs` is all that is kept. */
  generate(): { shown: string[]; hmacs: string[] } {
    const raw = new Set<string>()
    while (raw.size < RECOVERY_COUNT) raw.add(newCode())
    const codes = [...raw]
    return { shown: codes.map(pretty), hmacs: codes.map((c) => this.hmac(c)) }
  }

  /** Replaces every stored code (the old ones stop working). */
  replaceAll(hmacs: string[]): void {
    const now = this.clock.now()
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM recovery_codes').run()
      for (const h of hmacs) this.db.prepare('INSERT INTO recovery_codes(code_hmac, created_at) VALUES (?, ?)').run(h, now)
    })()
  }

  /** Spends one code. A code works exactly once, even if two requests arrive at the same moment. */
  use(input: string): boolean {
    if (normalise(input).length !== 10) return false
    return this.db.prepare('UPDATE recovery_codes SET used_at = ? WHERE code_hmac = ? AND used_at IS NULL').run(this.clock.now(), this.hmac(input)).changes === 1
  }

  remaining(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM recovery_codes WHERE used_at IS NULL').get() as { c: number }).c
  }
}
