import type { Db } from './db'
import type { DashboardData, DashboardDay, DashboardPeriod, LogRow } from '@autobot/contracts/ipc'

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

const KIND: [string, keyof Omit<DashboardDay, 'day'>][] = [
  ['replied', 'replied'], ['out_of_context', 'refused'], ['handoff', 'handoff'], ['error', 'errors']
]
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Seven local calendar days ending today (DST-safe: each day starts at that day's own local midnight). */
function trend(db: Db, now: number): DashboardDay[] {
  const days: DashboardDay[] = []
  const starts: number[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    starts.push(d.getTime())
    days.push({ day: dayKey(d), replied: 0, refused: 0, handoff: 0, errors: 0 })
  }
  const rows = db.prepare('SELECT decision, created_at FROM message_log WHERE created_at >= ? AND created_at <= ?')
    .all(starts[0], now) as { decision: string; created_at: number }[]
  for (const r of rows) {
    const kind = KIND.find(([prefix]) => r.decision.startsWith(prefix))
    if (!kind) continue
    let i = starts.length - 1
    while (i > 0 && r.created_at < starts[i]) i--
    days[i][kind[1]]++
  }
  return days
}

/** Numbers for the dashboard. "Today" starts at local midnight of the machine; "week" is the last 7×24 hours. */
export function buildDashboard(db: Db, now: number): DashboardData {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const count = (sql: string, ...args: unknown[]): number => (db.prepare(sql).get(...args) as { n: number }).n
  return {
    today: period(db, midnight.getTime()),
    week: period(db, now - WEEK_MS),
    trend: trend(db, now),
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
