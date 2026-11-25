import type { FeedMessage } from '@autobot/contracts/ipc'

/** Messages older than this are history (e.g. after a reconnect), not something to interrupt the user for. */
export const FRESH_MS = 120_000
const BODY_MAX = 120

/** What to show for a new customer message, or null for none. Only an owner who is signed in ever receives the event. */
export function incomingNotification(
  m: FeedMessage,
  ctx: { enabled: boolean; now: number }
): { title: string; body: string } | null {
  if (!ctx.enabled || m.direction !== 'in' || ctx.now - m.at > FRESH_MS) return null
  const who = m.isGroup ? 'Pesan di grup' : `Pesan dari ${m.chatId.split('@')[0]}`
  return { title: who, body: (m.text || '(pesan non-teks)').slice(0, BODY_MAX) }
}

/** The notice for a chat that needs a person: the bot could not answer, or handed the customer over. */
export function attentionNotification(kind: 'escalate' | 'handoff', e: { chatId: string; text?: string | null; reason?: string }): { title: string; body: string } {
  const number = e.chatId.split('@')[0]
  return kind === 'escalate'
    ? { title: 'Perlu dibalas manual', body: (e.text ?? '').slice(0, BODY_MAX) || `Pesan dari ${number}` }
    : { title: 'Pelanggan diserahkan ke admin', body: `${number}${e.reason ? ` · ${e.reason}` : ''}`.slice(0, BODY_MAX) }
}
