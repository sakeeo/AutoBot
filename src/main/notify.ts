import type { FeedMessage } from '../shared/ipc'

/** Messages older than this are history (e.g. after a reconnect), not something to interrupt the user for. */
export const FRESH_MS = 120_000
const BODY_MAX = 120

/**
 * What to show for a new message, or null for none. While the app is locked the notice carries neither
 * the sender nor the text: a notification is visible on a locked screen.
 */
export function incomingNotification(
  m: FeedMessage,
  ctx: { enabled: boolean; locked: boolean; now: number }
): { title: string; body: string } | null {
  if (!ctx.enabled || m.direction !== 'in' || ctx.now - m.at > FRESH_MS) return null
  if (ctx.locked) return { title: 'AutoBot', body: 'Ada pesan baru' }
  const who = m.isGroup ? 'Pesan di grup' : `Pesan dari ${m.chatId.split('@')[0]}`
  return { title: who, body: (m.text || '(pesan non-teks)').slice(0, BODY_MAX) }
}
