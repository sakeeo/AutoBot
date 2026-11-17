import { EventEmitter } from 'node:events'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import ignore, { type Ignore } from 'ignore'
import { chunkText } from './chunker'
import type { IndexStore } from './index-store'
import { loadDocument, LoaderError, SUPPORTED_EXTENSIONS } from './loaders'

/** Never indexed, whatever the user configures. */
const ALWAYS_EXCLUDED = ['.env', '.env.*', '*.key', '*.pem', 'node_modules/', '.git/']

export interface IndexStatusEvent {
  file: string
  status: 'indexed' | 'failed' | 'removed'
  reason?: string
}

interface Root {
  dir: string
  ig: Ignore
}

const normalizePath = (file: string): string => file.replace(/\\/g, '/')

export class Indexer extends EventEmitter {
  private roots: Root[] = []
  private watcher: FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()
  private debounceMs: number

  private onDocument?: (file: string, raw: string, ext: string) => void
  private onRemove?: (file: string) => void

  constructor(
    private store: IndexStore,
    opts: {
      debounceMs?: number
      /** Called with the raw text of every successfully indexed .csv/.json file (e.g. for the product catalog). */
      onDocument?: (file: string, raw: string, ext: string) => void
      onRemove?: (file: string) => void
    } = {}
  ) {
    super()
    this.debounceMs = opts.debounceMs ?? 500
    this.onDocument = opts.onDocument
    this.onRemove = opts.onRemove
  }

  async start(folders: string[], exclude: string[]): Promise<void> {
    await this.stop()
    this.roots = folders.map((dir) => ({ dir: normalizePath(dir), ig: ignore().add([...ALWAYS_EXCLUDED, ...exclude]) }))
    for (const root of this.roots) await this.scan(root.dir, false)
    if (this.roots.length === 0) return
    this.watcher = watch(
      this.roots.map((r) => r.dir),
      {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
        ignored: (p) => p.split(sep).some((s) => s === 'node_modules' || s === '.git')
      }
    )
    this.watcher.on('add', (f) => this.schedule(f, false))
    this.watcher.on('change', (f) => this.schedule(f, false))
    this.watcher.on('unlink', (f) => this.schedule(f, true))
    const w = this.watcher
    await new Promise<void>((resolve) => w.once('ready', () => resolve()))
  }

  async stop(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    const w = this.watcher
    this.watcher = null
    if (w) await w.close()
  }

  async reindexAll(): Promise<void> {
    for (const root of this.roots) await this.scan(root.dir, true)
  }

  private schedule(file: string, removed: boolean): void {
    const normalized = normalizePath(file)
    const prev = this.timers.get(normalized)
    if (prev) clearTimeout(prev)
    this.timers.set(
      normalized,
      setTimeout(() => {
        this.timers.delete(normalized)
        const job = removed ? this.remove(normalized) : this.indexFile(normalized, false)
        job.catch(() => undefined)
      }, this.debounceMs)
    )
  }

  private rootOf(file: string): Root | undefined {
    const normalized = normalizePath(file)
    return this.roots.find((r) => !relative(r.dir, normalized).startsWith('..'))
  }

  private isExcluded(file: string): boolean {
    const root = this.rootOf(file)
    if (!root) return true
    const rel = normalizePath(relative(root.dir, file)).split(sep).join('/')
    return rel === '' || root.ig.ignores(rel)
  }

  private async scan(dir: string, force: boolean): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = normalizePath(join(dir, e.name))
      if (e.isDirectory()) {
        const root = this.rootOf(full)
        const rel = root ? normalizePath(relative(root.dir, full)).split(sep).join('/') : ''
        if (root && root.ig.ignores(rel + '/')) continue
        await this.scan(full, force)
      } else if (e.isFile()) {
        await this.indexFile(full, force)
      }
    }
  }

  private async indexFile(file: string, force: boolean): Promise<void> {
    const normalized = normalizePath(file)
    if (this.isExcluded(normalized)) return
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(normalized).toLowerCase())) return
    try {
      const mtime = (await stat(normalized)).mtimeMs
      if (!force && this.store.getMtime(normalized) === mtime) return
      const { text } = await loadDocument(normalized)
      const chunks = chunkText(text)
      this.store.replaceFile(normalized, mtime, chunks)
      const ext = extname(normalized).toLowerCase()
      if (this.onDocument && (ext === '.csv' || ext === '.json'))
        this.onDocument(normalized, await readFile(normalized, 'utf8'), ext)
      this.emit('status', { file: normalized, status: 'indexed' } satisfies IndexStatusEvent)
    } catch (e) {
      const reason = e instanceof LoaderError ? e.code : 'PARSE_FAILED'
      this.store.markFailed(normalized, reason)
      this.emit('status', { file: normalized, status: 'failed', reason } satisfies IndexStatusEvent)
    }
  }

  private async remove(file: string): Promise<void> {
    const normalized = normalizePath(file)
    this.store.removeFile(normalized)
    this.onRemove?.(normalized)
    this.emit('status', { file: normalized, status: 'removed' } satisfies IndexStatusEvent)
  }
}
