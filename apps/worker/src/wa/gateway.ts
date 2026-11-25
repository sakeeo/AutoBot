import type { ConnStatus, IncomingMessage } from '@autobot/contracts/types'

export type { ConnStatus, IncomingMessage }

export interface WaGateway {
  onMessage(cb: (m: IncomingMessage) => void): void
  onStatus(cb: (s: ConnStatus) => void): void
  /** Sends a text message and resolves with its WhatsApp message id (null if unknown). */
  sendText(chatId: string, text: string, opts?: { typingMs?: number }): Promise<string | null>
  /** Which of these phone numbers are on WhatsApp, with the jid WhatsApp knows them by. */
  onWhatsApp(numbers: string[]): Promise<{ number: string; jid: string | null; exists: boolean }[]>
  /** Digits of the number this bot is linked to, or null while disconnected. */
  selfNumber(): string | null
  /** Chat id (jid) for any phone number format. */
  jidFor(number: string): string
  connect(): Promise<void>
  /** Closes the connection without logging out (the session stays on disk). Used when the process shuts down. */
  stop?(): Promise<void>
  logout(): Promise<void>
}
