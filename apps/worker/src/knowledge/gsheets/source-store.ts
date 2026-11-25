import { randomUUID } from 'node:crypto'
import type { GsError, GsRole, GsSource, GsStatus, CatalogField } from '@autobot/contracts/sheets'
import type { Db } from '../../db'

interface Row {
  id: string; name: string; spreadsheet_id: string; gid: number; tab_title: string; range: string | null; role: GsRole
  mapping_json: string; interval_min: number; enabled: number; file: string; content_hash: string | null; row_count: number
  last_sync_at: number | null; last_ok_at: number | null; last_status: GsStatus; last_error: GsError | null
  last_summary: string | null; consecutive_failures: number; pending_json: string | null; warnings_json: string; created_at: number
}

/** Content waiting for the owner's decision (a big shrink); applied by "Terapkan" without asking Google again. */
export interface Pending { reason: 'shrink' | 'domain'; summary: string; staged?: { content: string; hash: string; rowCount: number } }

const parse = <T>(s: string | null, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback } catch { return fallback } }

export class SourceStore {
  constructor(private db: Db) {}

  private toSource(r: Row): GsSource {
    const m = parse<{ mapping?: Partial<Record<CatalogField, string>>; columns?: string[] }>(r.mapping_json, {})
    const p = parse<Pending | null>(r.pending_json, null)
    return {
      id: r.id, name: r.name, spreadsheetId: r.spreadsheet_id, gid: r.gid, tabTitle: r.tab_title, range: r.range, role: r.role,
      mapping: m.mapping ?? {}, columns: m.columns ?? [], intervalMin: r.interval_min, enabled: r.enabled === 1, file: r.file,
      lastSyncAt: r.last_sync_at, lastOkAt: r.last_ok_at, lastStatus: r.last_status, lastError: r.last_error,
      lastSummary: r.last_summary, rowCount: r.row_count, consecutiveFailures: r.consecutive_failures,
      pending: p ? { reason: p.reason, summary: p.summary } : null, warnings: parse<string[]>(r.warnings_json, [])
    }
  }

  list(): GsSource[] {
    return (this.db.prepare('SELECT * FROM knowledge_sources ORDER BY created_at, id').all() as Row[]).map((r) => this.toSource(r))
  }
  get(id: string): GsSource | null {
    const r = this.db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id) as Row | undefined
    return r ? this.toSource(r) : null
  }
  count(): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM knowledge_sources').get() as { n: number }).n }
  fileTaken(file: string): boolean { return !!this.db.prepare('SELECT 1 FROM knowledge_sources WHERE file = ?').get(file) }
  duplicate(spreadsheetId: string, gid: number, range: string | null): boolean {
    return !!this.db.prepare('SELECT 1 FROM knowledge_sources WHERE spreadsheet_id = ? AND gid = ? AND IFNULL(range, \'\') = ?').get(spreadsheetId, gid, range ?? '')
  }
  hash(id: string): string | null {
    return (this.db.prepare('SELECT content_hash AS h FROM knowledge_sources WHERE id = ?').get(id) as { h: string | null } | undefined)?.h ?? null
  }
  pending(id: string): Pending | null {
    const r = this.db.prepare('SELECT pending_json AS p FROM knowledge_sources WHERE id = ?').get(id) as { p: string | null } | undefined
    return parse<Pending | null>(r?.p ?? null, null)
  }

  insert(s: { name: string; spreadsheetId: string; gid: number; tabTitle: string; range: string | null; role: GsRole;
    mapping: Partial<Record<CatalogField, string>>; columns: string[]; intervalMin: number; file: string }, now: number): string {
    const id = randomUUID()
    this.db.prepare(
      `INSERT INTO knowledge_sources(id, name, spreadsheet_id, gid, tab_title, range, role, mapping_json, interval_min, file, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, s.name, s.spreadsheetId, s.gid, s.tabTitle, s.range, s.role, JSON.stringify({ mapping: s.mapping, columns: s.columns }), s.intervalMin, s.file, now)
    return id
  }

  update(id: string, p: { name?: string; range?: string | null; mapping?: Partial<Record<CatalogField, string>>; columns?: string[]; intervalMin?: number; enabled?: boolean }): void {
    const cur = this.get(id)
    if (!cur) return
    this.db.prepare('UPDATE knowledge_sources SET name = ?, range = ?, mapping_json = ?, interval_min = ?, enabled = ? WHERE id = ?').run(
      p.name ?? cur.name, p.range === undefined ? cur.range : p.range,
      JSON.stringify({ mapping: p.mapping ?? cur.mapping, columns: p.columns ?? cur.columns }),
      p.intervalMin ?? cur.intervalMin, (p.enabled ?? cur.enabled) ? 1 : 0, id
    )
  }

  remove(id: string): void { this.db.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(id) }

  markSyncing(id: string, now: number): void {
    this.db.prepare("UPDATE knowledge_sources SET last_status = 'syncing', last_sync_at = ? WHERE id = ?").run(now, id)
  }
  markOk(id: string, o: { now: number; hash: string; rowCount: number; summary: string; warnings: string[]; pending: Pending | null }): void {
    this.db.prepare(
      `UPDATE knowledge_sources SET last_status = 'ok', last_error = NULL, last_sync_at = ?, last_ok_at = ?, content_hash = ?, row_count = ?,
       last_summary = ?, warnings_json = ?, pending_json = ?, consecutive_failures = 0 WHERE id = ?`
    ).run(o.now, o.now, o.hash, o.rowCount, o.summary, JSON.stringify(o.warnings), o.pending ? JSON.stringify(o.pending) : null, id)
  }
  /** Same content as last time: only the timestamps move. */
  markUnchanged(id: string, now: number, warnings: string[], pending: Pending | null): void {
    this.db.prepare(
      `UPDATE knowledge_sources SET last_status = 'ok', last_error = NULL, last_sync_at = ?, last_ok_at = ?, warnings_json = ?, pending_json = ?,
       consecutive_failures = 0 WHERE id = ?`
    ).run(now, now, JSON.stringify(warnings), pending ? JSON.stringify(pending) : null, id)
  }
  markError(id: string, now: number, error: GsError): void {
    this.db.prepare(
      "UPDATE knowledge_sources SET last_status = 'error', last_error = ?, last_sync_at = ?, consecutive_failures = consecutive_failures + 1 WHERE id = ?"
    ).run(error, now, id)
  }
  markNeedsConfirm(id: string, now: number, pending: Pending): void {
    this.db.prepare(
      "UPDATE knowledge_sources SET last_status = 'needs_confirm', last_error = NULL, last_sync_at = ?, pending_json = ?, consecutive_failures = 0 WHERE id = ?"
    ).run(now, JSON.stringify(pending), id)
  }
  clearPending(id: string): void {
    this.db.prepare("UPDATE knowledge_sources SET pending_json = NULL, last_status = CASE WHEN last_status = 'needs_confirm' THEN 'ok' ELSE last_status END WHERE id = ?").run(id)
  }
  /** After a restart no sync can be running, so anything left as `syncing` was interrupted. */
  resetSyncing(): void {
    this.db.prepare("UPDATE knowledge_sources SET last_status = 'error', last_error = 'UPSTREAM' WHERE last_status = 'syncing'").run()
  }

  domains(): string[] { return (this.db.prepare('SELECT domain FROM approved_domains ORDER BY domain').all() as { domain: string }[]).map((r) => r.domain) }
  approveDomain(domain: string, now: number): void {
    this.db.prepare("INSERT OR IGNORE INTO approved_domains(domain, approved_at, approved_by) VALUES (?, ?, 'owner')").run(domain, now)
  }
}
