import type { ConnStatus, IncomingMessage } from '../../shared/types'

export type { ConnStatus, IncomingMessage }

export interface WaGateway {
  onMessage(cb: (m: IncomingMessage) => void): void
  onStatus(cb: (s: ConnStatus) => void): void
  /** Sends a text message and resolves with its WhatsApp message id (null if unknown). */
  sendText(chatId: string, text: string, opts?: { typingMs?: number }): Promise<string | null>
  /** Digits of the number this bot is linked to, or null while disconnected. */
  selfNumber(): string | null
  /** Chat id (jid) for any phone number format. */
  jidFor(number: string): string
  connect(): Promise<void>
  logout(): Promise<void>
}
