import type { Db } from '../db'
import type { BroadcastStore } from './store'
import { numberFromJid } from './identity'

const YEAR_MS = 365 * 86_400_000

/**
 * Chat contacts = people who wrote to the bot in the last 365 days, from the old decision log and the new message
 * table together. Returns how many were new. Someone silent for over a year is retired from the audience.
 */
export function syncChatContacts(db: Db, store: BroadcastStore, now: number): number {
  const cutoff = now - YEAR_MS
  const rows = db
    .prepare(
      `SELECT chat_id, MAX(at) AS at FROM (
         SELECT chat_id, created_at AS at FROM messages WHERE direction = 'in' AND is_group = 0
         UNION ALL SELECT chat_id, created_at AS at FROM message_log
       )
       WHERE chat_id NOT LIKE '%@g.us' AND chat_id NOT LIKE '%@broadcast'
       GROUP BY chat_id HAVING MAX(at) >= ?`
    )
    .all(cutoff) as { chat_id: string; at: number }[]

  let added = 0
  for (const r of rows) {
    const number = numberFromJid(r.chat_id)
    if (!store.findContact({ number, jid: r.chat_id })) {
      store.upsertContact({ number, jid: r.chat_id, source: 'chat', status: 'aktif' })
      added++
    }
    // Also activates an imported contact who has now written to us, and never revives an inactive one.
    store.recordInbound({ number, jid: r.chat_id }, r.at)
  }
  db.prepare("UPDATE broadcast_contacts SET status = 'tidak_aktif' WHERE source = 'chat' AND status = 'aktif' AND last_inbound_at IS NOT NULL AND last_inbound_at < ?").run(cutoff)
  return added
}
