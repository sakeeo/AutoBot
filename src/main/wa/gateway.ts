import type { ConnStatus, IncomingMessage } from '../../shared/types'

export type { ConnStatus, IncomingMessage }

export interface WaGateway {
  onMessage(cb: (m: IncomingMessage) => void): void
  onStatus(cb: (s: ConnStatus) => void): void
  sendText(chatId: string, text: string, opts?: { typingMs?: number }): Promise<void>
  connect(): Promise<void>
  logout(): Promise<void>
}
