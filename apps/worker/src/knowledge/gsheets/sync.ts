import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GsError, GsRole, GsSource, GsSyncEvent } from '@autobot/contracts/sheets'
import type { Indexer } from '../indexer'
import { GsFailure } from './errors'
import { catalogDiff, catalogJson, knowledgeText, sha256, slugify, toTable, type CatalogRow } from './format'
import type { SheetsSource } from './client'
import type { Pending, SourceStore } from './source-store'

export const GS_DIR = '_gsheets'
const TICK_MS = 60_000
const FIRST_TICK_MS = 30_000
const SHRINK_MIN_ROWS = 10

export interface SyncDeps {
  store: SourceStore
  source: () => SheetsSource
  hasCredential: () => boolean
  knowledgeDir: string
  indexer: Pick<Indexer, 'indexFile' | 'removeFile'>
  clock: { now(): number }
  /** Receives only error codes, never a response body or a key. */
  log?: (info: { id: string; status: string; error?: GsError }) => void
}

interface Built { content: string; rowCount: number; warnings: string[]; pending: Pending | null; diff: (previous: string | null) => string }

/** The relative path (inside the knowledge folder) a source is written to. Derived from the name, never from user input. */
export function fileFor(store: SourceStore, name: string, role: GsRole): string {
  const slug = slugify(name)
  for (let n = 1; ; n++) {
    const s = n === 1 ? slug : `${slug}-${n}`
    const file = role === 'catalog' ? `${GS_DIR}/${s}/katalog.json` : `${GS_DIR}/${s}.txt`
    if (!store.fileTaken(file)) return file
  }
}

/**
 * Pulls Google Sheets into the knowledge folder. Principle: a failed or suspicious sync never changes what the bot knows.
 * Only a sync that passes every guard writes the file (atomically) and re-indexes it.
 */
export class SheetSyncService extends EventEmitter {
  private running = new Map<string, Promise<void>>()
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null

  constructor(private d: SyncDeps) { super() }

  start(): void {
    this.d.store.resetSyncing()
    this.first = setTimeout(() => { void this.tick() }, FIRST_TICK_MS)
    this.first.unref()
    this.timer = setInterval(() => { void this.tick() }, TICK_MS)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = this.timer = null
    await Promise.allSettled([...this.running.values()])
  }

  private emitEvent(e: Omit<GsSyncEvent, 'at'>): void { this.emit('sync', { ...e, at: this.d.clock.now() } satisfies GsSyncEvent) }

  isDue(s: GsSource, now: number): boolean {
    if (!s.enabled) return false
    if (s.lastStatus === 'syncing') return false
    if (s.lastStatus === 'error' && (s.lastError === 'CREDENTIAL_INVALID' || s.lastError === 'NO_CREDENTIAL')) return false
    if (s.lastSyncAt === null) return true
    const interval = s.intervalMin * 60_000
    const wait = s.consecutiveFailures > 0 ? Math.min(interval, 60_000 * 2 ** s.consecutiveFailures) : interval
    return now - s.lastSyncAt >= wait
  }

  /** One scheduler pass: the sources that are due, one at a time. */
  async tick(): Promise<void> {
    if (!this.d.hasCredential()) return
    for (const s of this.d.store.list()) {
      if (!this.isDue(s, this.d.clock.now())) continue
      await this.syncNow(s.id).catch(() => undefined)
    }
  }

  /** Two clicks on "Sinkron sekarang" share one run. */
  syncNow(id: string): Promise<void> {
    const existing = this.running.get(id)
    if (existing) return existing
    const p = this.run(id).finally(() => this.running.delete(id))
    this.running.set(id, p)
    return p
  }

  /** Retries everything that was stopped for lack of a (valid) key, e.g. right after a new key is saved. */
  async syncAll(): Promise<void> {
    for (const s of this.d.store.list()) if (s.enabled) await this.syncNow(s.id).catch(() => undefined)
  }

  private abs(file: string): string { return join(this.d.knowledgeDir, file) }

  private async build(s: GsSource): Promise<Built> {
    const src = this.d.source()
    const formatted = toTable(await src.read(s.spreadsheetId, s.tabTitle, s.range, 'FORMATTED_VALUE'))
    if (s.role === 'knowledge') {
      const { text, rowCount } = knowledgeText(formatted, s.columns)
      return { content: text, rowCount, warnings: [], pending: null, diff: (prev) => `${rowCount} baris${prev === null ? '' : ` (sebelumnya ${s.rowCount})`}` }
    }
    const raw = s.mapping.harga ? toTable(await src.read(s.spreadsheetId, s.tabTitle, s.range, 'UNFORMATTED_VALUE')) : null
    const b = catalogJson(formatted, raw, s.mapping, new Set(this.d.store.domains()))
    const pending: Pending | null = b.unapprovedDomains.length
      ? { reason: 'domain', summary: `Domain checkout belum disetujui: ${b.unapprovedDomains.join(', ')}. Tautan dari domain itu tidak dipakai bot sampai Anda menyetujuinya.` }
      : null
    return {
      content: b.json, rowCount: b.rowCount, warnings: b.problems.slice(0, 20), pending,
      diff: (prev) => {
        let before: CatalogRow[] = []
        try { before = prev ? (JSON.parse(prev) as CatalogRow[]) : [] } catch { /* an unreadable old file counts as empty */ }
        return catalogDiff(before, b.items)
      }
    }
  }

  private async readPrevious(file: string): Promise<string | null> {
    try { return await readFile(this.abs(file), 'utf8') } catch { return null }
  }

  /** Writes the new content next to the old file and swaps it in: the old file or the new one is whole, never half. */
  private async write(file: string, content: string): Promise<void> {
    const target = this.abs(file)
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.tmp`
    await writeFile(tmp, content, { mode: 0o600 })
    await rename(tmp, target)
    await this.d.indexer.indexFile(target, true)
  }

  private async run(id: string): Promise<void> {
    const s = this.d.store.get(id)
    if (!s) return
    const now = this.d.clock.now()
    if (!this.d.hasCredential()) {
      this.d.store.markError(id, now, 'NO_CREDENTIAL')
      this.emitEvent({ id, status: 'error', error: 'NO_CREDENTIAL' })
      return
    }
    this.d.store.markSyncing(id, now)
    this.emitEvent({ id, status: 'syncing' })
    try {
      const b = await this.build(s)
      const hash = sha256(b.content)
      const done = this.d.clock.now()
      if (b.rowCount === 0 && s.rowCount === 0) throw new GsFailure('EMPTY')
      if (hash === this.d.store.hash(id) && existsSync(this.abs(s.file))) {
        this.d.store.markUnchanged(id, done, b.warnings, b.pending)
        this.emitEvent({ id, status: 'ok', rowCount: s.rowCount })
        return
      }
      if (s.rowCount >= SHRINK_MIN_ROWS && b.rowCount < s.rowCount * 0.5) {
        const pending: Pending = {
          reason: 'shrink', staged: { content: b.content, hash, rowCount: b.rowCount },
          summary: `Jumlah baris turun dari ${s.rowCount} menjadi ${b.rowCount}. Perubahan ditahan agar pengetahuan bot tidak hilang karena edit yang belum selesai.`
        }
        this.d.store.markNeedsConfirm(id, done, pending)
        this.emitEvent({ id, status: 'needs_confirm', rowCount: s.rowCount })
        return
      }
      const summary = b.diff(await this.readPrevious(s.file))
      await this.write(s.file, b.content)
      this.d.store.markOk(id, { now: done, hash, rowCount: b.rowCount, summary, warnings: b.warnings, pending: b.pending })
      this.emitEvent({ id, status: 'ok', rowCount: b.rowCount })
      this.d.log?.({ id, status: 'ok' })
    } catch (e) {
      const code: GsError = e instanceof GsFailure ? e.code : 'UPSTREAM'
      this.d.store.markError(id, this.d.clock.now(), code)
      this.emitEvent({ id, status: 'error', error: code })
      this.d.log?.({ id, status: 'error', error: code })
    }
  }

  /** The owner accepted a held change: write what was staged. */
  async confirm(id: string): Promise<void> {
    const s = this.d.store.get(id)
    const p = this.d.store.pending(id)
    if (!s || !p || p.reason !== 'shrink' || !p.staged) return
    const summary = `${p.staged.rowCount} baris (sebelumnya ${s.rowCount}); disetujui pemilik`
    await this.write(s.file, p.staged.content)
    this.d.store.markOk(id, { now: this.d.clock.now(), hash: p.staged.hash, rowCount: p.staged.rowCount, summary, warnings: s.warnings, pending: null })
    this.emitEvent({ id, status: 'ok', rowCount: p.staged.rowCount })
  }

  dismiss(id: string): void {
    this.d.store.clearPending(id)
    this.emitEvent({ id, status: this.d.store.get(id)?.lastStatus ?? 'ok' })
  }

  /** Removes the source and everything it made: the file, its chunks in the index and its products. */
  async remove(id: string): Promise<void> {
    const s = this.d.store.get(id)
    if (!s) return
    await this.running.get(id)?.catch(() => undefined)
    const target = this.abs(s.file)
    await this.d.indexer.removeFile(target)
    await rm(s.role === 'catalog' ? dirname(target) : target, { recursive: true, force: true })
    this.d.store.remove(id)
  }
}

