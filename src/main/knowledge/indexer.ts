import { EventEmitter } from 'node:events'
import { readdir, stat } from 'node:fs/promises'
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

export class Indexer extends EventEmitter {
  private roots: Root[] = []
  private watcher: FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()
  private debounceMs: number

  constructor(private store: IndexStore, opts: { debounceMs?: number } = {}) {
    super()
    this.debounceMs = opts.debounceMs ?? 500
  }

  async start(folders: string[], exclude: string[]): Promise<void> {
    await this.stop()
    this.roots = folders.map((dir) => ({ dir, ig: ignore().add([...ALWAYS_EXCLUDED, ...exclude]) }))
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
    const prev = this.timers.get(file)
    if (prev) clearTimeout(prev)
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file)
        const job = removed ? this.remove(file) : this.indexFile(file, false)
        job.catch(() => undefined)
      }, this.debounceMs)
    )
  }

  private rootOf(file: string): Root | undefined {
    return this.roots.find((r) => !relative(r.dir, file).startsWith('..'))
  }

  private isExcluded(file: string): boolean {
    const root = this.rootOf(file)
    if (!root) return true
    const rel = relative(root.dir, file).split(sep).join('/')
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
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        const root = this.rootOf(full)
        const rel = root ? relative(root.dir, full).split(sep).join('/') : ''
        if (root && root.ig.ignores(rel + '/')) continue
        await this.scan(full, force)
      } else if (e.isFile()) {
        await this.indexFile(full, force)
      }
    }
  }

  private async indexFile(file: string, force: boolean): Promise<void> {
    if (this.isExcluded(file)) return
    if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extname(file).toLowerCase())) return
    try {
      const mtime = (await stat(file)).mtimeMs
      if (!force && this.store.getMtime(file) === mtime) return
      const { text } = await loadDocument(file)
      const chunks = chunkText(text)
      this.store.replaceFile(file, mtime, chunks)
      this.emit('status', { file, status: 'indexed' } satisfies IndexStatusEvent)
    } catch (e) {
      const reason = e instanceof LoaderError ? e.code : 'PARSE_FAILED'
      this.store.markFailed(file, reason)
      this.emit('status', { file, status: 'failed', reason } satisfies IndexStatusEvent)
    }
  }

  private async remove(file: string): Promise<void> {
    this.store.removeFile(file)
    this.emit('status', { file, status: 'removed' } satisfies IndexStatusEvent)
  }
}
