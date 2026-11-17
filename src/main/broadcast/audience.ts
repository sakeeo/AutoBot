import type { Db } from '../db'
import type { BroadcastStore } from './store'
import { isLidJid, numberFromJid } from './identity'

const YEAR_MS = 365 * 86_400_000

/**
 * Chat contacts = people who wrote to the bot in the last 365 days, from the old decision log and the new message
 * table together. Returns how many were new. Someone silent for over a year is retired from the audience.
 * A lid chat gets its phone number from the phone jid WhatsApp reported with its messages, when there was one.
 */
export function syncChatContacts(db: Db, store: BroadcastStore, now: number): number {
  const cutoff = now - YEAR_MS
  const rows = db
    .prepare(
      `SELECT chat_id, MAX(at) AS at, MAX(alt_jid) AS alt_jid FROM (
         SELECT chat_id, created_at AS at, alt_jid FROM messages WHERE direction = 'in' AND is_group = 0
         UNION ALL SELECT chat_id, created_at AS at, NULL AS alt_jid FROM message_log
       )
       WHERE chat_id NOT LIKE '%@g.us' AND chat_id NOT LIKE '%@broadcast'
       GROUP BY chat_id HAVING MAX(at) >= ?`
    )
    .all(cutoff) as { chat_id: string; at: number; alt_jid: string | null }[]

  let added = 0
  for (const r of rows) {
    const number = numberFromJid(r.chat_id) ?? (r.alt_jid ? numberFromJid(r.alt_jid) : null)
    const existing = store.findContact({ number, jid: r.chat_id })
    if (!existing) {
      store.upsertContact({ number, jid: r.chat_id, source: 'chat', status: 'aktif' })
      added++
    } else if (number && !existing.number) {
      // A lid-only contact whose number we have now learned.
      store.upsertContact({ number, jid: r.chat_id, source: existing.source, status: existing.status })
    }
    // Also activates an imported contact who has now written to us, and never revives an inactive one.
    store.recordInbound({ number, jid: r.chat_id }, r.at)
  }
  db.prepare("UPDATE broadcast_contacts SET status = 'tidak_aktif' WHERE source = 'chat' AND status = 'aktif' AND last_inbound_at IS NOT NULL AND last_inbound_at < ?").run(cutoff)
  return added
}

/**
 * Fills in the phone number of lid-only contacts by asking WhatsApp's own lid→phone mapping.
 * Returns how many were resolved.
 */
export async function resolveLidContacts(
  db: Db, store: BroadcastStore, phoneJidForLid: (lid: string) => Promise<string | null>
): Promise<number> {
  const rows = db.prepare('SELECT jid FROM broadcast_contacts WHERE number IS NULL AND jid IS NOT NULL').all() as { jid: string }[]
  let resolved = 0
  for (const { jid } of rows) {
    if (!isLidJid(jid)) continue
    const pn = await phoneJidForLid(jid).catch(() => null)
    const number = pn ? numberFromJid(pn.replace(/:\d+@/, '@')) : null
    if (!number) continue
    const c = store.findContact({ jid })
    if (!c || c.number) continue
    if (store.upsertContact({ number, jid, source: c.source, status: c.status }).number) resolved++
  }
  return resolved
}
