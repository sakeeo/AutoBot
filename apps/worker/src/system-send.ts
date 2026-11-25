import type { Db } from './db'
import type { WaGateway } from './wa/gateway'

/** What a system message is for. The text is built here from the kind, so a caller can never send free text. */
export type SystemKind =
  | 'otp_setup'
  | 'otp_reset'
  | 'otp_change_phone'
  | 'notice_password_changed'
  | 'notice_phone_changed'

export interface SystemSendRequest {
  /** Digits only, country code first, no plus (e.g. 6281234567890). */
  to: string
  kind: SystemKind
  /** Six digits; required for the otp_* kinds. */
  code?: string
  /** For notice_password_changed. */
  username?: string
  /** For notice_phone_changed: the last four digits of the new number. */
  last4?: string
}

export type SystemSendResult =
  | { ok: true }
  | { ok: false; code: 'WA_DISCONNECTED' | 'INVALID_NUMBER' | 'NOT_ON_WHATSAPP' | 'RATE_LIMITED' | 'BAD_REQUEST' }

export const SYSTEM_KINDS: readonly SystemKind[] = [
  'otp_setup', 'otp_reset', 'otp_change_phone', 'notice_password_changed', 'notice_phone_changed'
]
const OTP_KINDS: ReadonlySet<SystemKind> = new Set(['otp_setup', 'otp_reset', 'otp_change_phone'])

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** A second line of defence that does not depend on the web app's own limits. */
export const SYSTEM_LIMITS = { perHour: 10, perDay: 40 }

const when = (ms: number): string =>
  `${new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })} WIB`

export const maskNumber = (n: string): string => (n.length <= 4 ? '••••' : `${n.slice(0, 2)}••••${n.slice(-3)}`)

/** Builds the message text; returns null when the request is malformed. */
export function renderSystemText(req: SystemSendRequest, now: number): string | null {
  const code = req.code ?? ''
  if (OTP_KINDS.has(req.kind) && !/^\d{6}$/.test(code)) return null
  switch (req.kind) {
    case 'otp_setup':
      return `AutoBot — kode verifikasi nomor pemilik: ${code}. Berlaku 5 menit.`
    case 'otp_reset':
      return `AutoBot — kode RESET PASSWORD: ${code}. Berlaku 5 menit. Jika bukan Anda yang meminta, abaikan dan periksa keamanan akun.`
    case 'otp_change_phone':
      return `AutoBot — kode verifikasi nomor baru: ${code}. Berlaku 5 menit.`
    case 'notice_password_changed': {
      const name = (req.username ?? '').replace(/[^\w.@\- ]/g, '').slice(0, 40)
      if (!name) return null
      return `AutoBot — password akun "${name}" diubah pada ${when(now)}. Jika bukan Anda, jalankan reset-owner di server.`
    }
    case 'notice_phone_changed':
      if (!/^\d{4}$/.test(req.last4 ?? '')) return null
      return `AutoBot — nomor pemilik diganti ke ••••${req.last4} pada ${when(now)}. Jika bukan Anda, jalankan reset-owner di server.`
    default:
      return null
  }
}

export interface SystemSenderDeps {
  db: Db
  gateway: Pick<WaGateway, 'onWhatsApp' | 'selfNumber' | 'jidFor'>
  isConnected(): boolean
  /** Delivers the text without leaving any trace in the conversation (ReplyPipeline.sendSystem). */
  deliver(chatId: string, text: string): Promise<string | null>
  clock: { now(): number }
  log?: (info: { kind: SystemKind; to: string; result: string }) => void
}

/** Sends verification codes and notices to the owner. Nothing about the text is stored or logged. */
export class SystemSender {
  constructor(private d: SystemSenderDeps) {}

  async send(req: SystemSendRequest): Promise<SystemSendResult> {
    const now = this.d.clock.now()
    const done = (r: SystemSendResult): SystemSendResult => {
      this.d.log?.({ kind: req.kind, to: maskNumber(String(req.to)), result: r.ok ? 'sent' : r.code })
      return r
    }
    if (!SYSTEM_KINDS.includes(req.kind)) return done({ ok: false, code: 'BAD_REQUEST' })
    if (!/^[1-9]\d{7,14}$/.test(String(req.to))) return done({ ok: false, code: 'INVALID_NUMBER' })
    const text = renderSystemText(req, now)
    if (text === null) return done({ ok: false, code: 'BAD_REQUEST' })
    if (!this.d.isConnected()) return done({ ok: false, code: 'WA_DISCONNECTED' })
    if (this.sentSince(now - HOUR_MS) >= SYSTEM_LIMITS.perHour || this.sentSince(now - DAY_MS) >= SYSTEM_LIMITS.perDay)
      return done({ ok: false, code: 'RATE_LIMITED' })

    let jid: string
    if (req.to === this.d.gateway.selfNumber()) {
      jid = this.d.gateway.jidFor(req.to)
    } else {
      let found: { jid: string | null; exists: boolean } | undefined
      try {
        found = (await this.d.gateway.onWhatsApp([req.to]))[0]
      } catch {
        return done({ ok: false, code: 'WA_DISCONNECTED' })
      }
      if (!found?.exists || !found.jid) return done({ ok: false, code: 'NOT_ON_WHATSAPP' })
      jid = found.jid
    }

    // Counted before sending: a send that fails halfway must still use up its share of the limit.
    this.d.db.prepare('INSERT INTO system_send_log(at, kind) VALUES (?, ?)').run(now, req.kind)
    try {
      await this.d.deliver(jid, text)
    } catch {
      return done({ ok: false, code: 'WA_DISCONNECTED' })
    }
    return done({ ok: true })
  }

  private sentSince(ms: number): number {
    return (this.d.db.prepare('SELECT COUNT(*) AS c FROM system_send_log WHERE at > ?').get(ms) as { c: number }).c
  }
}
