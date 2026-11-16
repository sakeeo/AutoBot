import type { Db } from './db'
import type { DashboardData, DashboardPeriod, LogRow } from '../shared/ipc'

const WEEK_MS = 7 * 24 * 3_600_000

function period(db: Db, since: number): DashboardPeriod {
  const rows = db
    .prepare(
      `SELECT CASE
                WHEN decision LIKE 'replied%' THEN 'replied'
                WHEN decision LIKE 'out_of_context%' THEN 'refused'
                WHEN decision LIKE 'handoff%' THEN 'handoff'
                WHEN decision LIKE 'error%' THEN 'errors'
              END AS k, COUNT(*) AS n
       FROM message_log WHERE created_at >= ? GROUP BY k`
    )
    .all(since) as { k: string | null; n: number }[]
  const out: DashboardPeriod = { replied: 0, refused: 0, handoff: 0, errors: 0, links: 0 }
  for (const r of rows) if (r.k) out[r.k as keyof DashboardPeriod] = r.n
  out.links = (
    db.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN ('checkout_sent','link_sent') AND created_at >= ?").get(since) as {
      n: number
    }
  ).n
  return out
}

/** Numbers for the dashboard. "Today" starts at local midnight of the machine; "week" is the last 7×24 hours. */
export function buildDashboard(db: Db, now: number): DashboardData {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const count = (sql: string, ...args: unknown[]): number => (db.prepare(sql).get(...args) as { n: number }).n
  return {
    today: period(db, midnight.getTime()),
    week: period(db, now - WEEK_MS),
    waitingAdmin: count("SELECT COUNT(*) AS n FROM contacts WHERE status = 'menunggu_admin' AND paused_until > ?", now),
    recent: db
      .prepare(
        `SELECT message_id, chat_id, decision, top_score, sources, created_at, text
         FROM message_log ORDER BY created_at DESC LIMIT 5`
      )
      .all() as LogRow[],
    files: {
      indexed: count("SELECT COUNT(*) AS n FROM files WHERE status = 'indexed'"),
      failed: count("SELECT COUNT(*) AS n FROM files WHERE status = 'failed'")
    }
  }
}
