import type { ProviderId } from './providers'

export interface Settings {
  mode: 'extractive' | 'ai'
  outOfContext: { action: 'reply' | 'silent' | 'escalate'; replyText: string }
  threshold: number
  allowGroups: boolean
  cooldownSec: number
  ai: { provider: ProviderId; model: string; maxTokens: number; baseUrl?: string }
  theme: 'light' | 'dark' | 'auto'
  /** Browser notification for every new incoming chat message. */
  notifyIncoming: boolean
  /** The bot remembers returning customers (summary + facts). */
  memoryEnabled: boolean
}

export interface IncomingMessage {
  id: string
  chatId: string
  sender: string
  isGroup: boolean
  fromMe: boolean
  text: string | null
  timestamp: number
  /** For a lid chat: the phone jid WhatsApp reports for the same person, when it does. */
  altJid?: string
}

export type ConnStatus = {
  state: 'disconnected' | 'connecting' | 'waiting_qr' | 'connected'
  qr?: string
}

export interface Hit {
  chunkId: number
  file: string
  text: string
  coverage: number
  rank: number
}

export type Decision =
  | { kind: 'answerable'; hits: Hit[] }
  | { kind: 'out_of_context'; reason: 'no_tokens' | 'no_hits' | 'below_threshold' }

export interface Answer {
  text: string
  sources: string[]
}
