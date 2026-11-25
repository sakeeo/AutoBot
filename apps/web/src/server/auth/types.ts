/** What the web app needs from the worker. The real one speaks HTTP; tests use a fake. */
export interface WorkerPort {
  /** Digits of the number the bot is linked to, or null while WhatsApp is not connected. */
  selfNumber(): Promise<string | null>
  systemSend(req: { to: string; kind: string; code?: string; username?: string; last4?: string }): Promise<{ ok: true } | { ok: false; code: string }>
}

/** Who is asking: the address and browser of the request (the address only ever appears hashed in storage). */
export interface Ctx {
  ip: string
  ipHash: string
  userAgent: string
}

export type Fail = { ok: false; code: ErrorCode; message: string; retryAfterSec?: number }
export type Out<T extends object = Record<never, never>> = ({ ok: true } & T) | Fail

export type ErrorCode =
  | 'BAD_CREDENTIALS' | 'THROTTLED' | 'SESSION_EXPIRED' | 'INVALID_CODE' | 'VALIDATION' | 'FORBIDDEN'
  | 'CONFLICT' | 'WA_UNAVAILABLE' | 'NOT_FOUND' | 'STEP_UP_REQUIRED' | 'OTP_UNAVAILABLE'

export const fail = (code: ErrorCode, message: string, retryAfterSec?: number): Fail => ({ ok: false, code, message, ...(retryAfterSec ? { retryAfterSec } : {}) })

export interface UserRow {
  id: 1
  username: string
  password_hash: string
  owner_phone: string
  created_at: number
  password_changed_at: number
  totp_secret_enc: string | null
  totp_last_step: number
}

export const maskPhone = (n: string): string => (n.length <= 5 ? '••••' : `${n.slice(0, 2)}••••${n.slice(-3)}`)
