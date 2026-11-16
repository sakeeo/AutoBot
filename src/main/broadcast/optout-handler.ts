import type { IncomingMessage } from '../../shared/types'
import type { BroadcastStore, Key } from './store'
import { numberFromJid } from './identity'
import { START_CONFIRMATION, STOP_CONFIRMATION, classifyReply } from './optout'

const STALE_MS = 2 * 60_000

export interface OptOutDeps {
  store: BroadcastStore
  clock: { now(): number }
  /** Has this person ever been sent a broadcast or a confirmation? */
  wasBroadcastTo(key: Key): boolean
  reply(chatId: string, text: string): Promise<void>
  isHumanHandling(chatId: string): boolean
  onSignal(kind: 'optout' | 'complaint' | 'reply'): void
  /** A complaint from a recipient: a person should look at it, the bot does not answer. */
  onComplaint?(m: IncomingMessage): void
}

/**
 * Runs before the agent. Returns true when the message was dealt with and must not reach the agent.
 * Opt-outs count however old the message is (it may have waited while the app was closed); only the automatic
 * reply is skipped for an old message. Someone never broadcast to who types "stop" is only noted (soft
 * suppression); the bot still answers normally.
 */
export class OptOutHandler {
  constructor(private d: OptOutDeps) {}

  async handle(m: IncomingMessage): Promise<boolean> {
    if (m.isGroup || m.fromMe || m.chatId.endsWith('@broadcast') || m.text === null) return false
    const fresh = this.d.clock.now() - m.timestamp <= STALE_MS
    const { store } = this.d
    // A lid chat has no phone number of its own; use the one WhatsApp reports so both identities are covered.
    const key: Key = { jid: m.chatId, number: numberFromJid(m.chatId) ?? (m.altJid ? numberFromJid(m.altJid) : null) }
    const was = this.d.wasBroadcastTo(key)
    const kind = classifyReply(m.text)

    if (kind === 'start') {
      if (store.isSuppressed(key)?.reason !== 'berhenti') return false
      store.unsuppress(key, 'berhenti')
      if (fresh) await this.d.reply(m.chatId, START_CONFIRMATION)
      return true
    }

    if (kind === 'stop') {
      const already = store.isSuppressed(key)
      if (!was) {
        if (!already) store.suppress({ ...key, reason: 'tolak_lunak' })
        return false
      }
      store.suppress({ ...key, reason: 'berhenti' })
      if (!already) {
        this.d.onSignal('optout')
        if (fresh && !this.d.isHumanHandling(m.chatId)) await this.d.reply(m.chatId, STOP_CONFIRMATION)
      }
      return true
    }

    if (kind === 'complaint') {
      store.suppress({ ...key, reason: 'laporan' })
      if (!was) return false
      this.d.onSignal('complaint')
      this.d.onComplaint?.(m)
      return true
    }

    const contact = store.recordInbound(key, m.timestamp)
    if (contact && was) this.d.onSignal('reply')
    return false
  }
}
